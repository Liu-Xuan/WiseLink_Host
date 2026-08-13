import { Inject, Injectable } from '@nestjs/common';
import {
  DRIZZLE_DATABASE,
  type PostgresJsDatabase,
} from '@lark-apaas/fullstack-nestjs-core';
import { and, eq, isNull, sql } from 'drizzle-orm';

import {
  dmAcquisition,
  dmCurrentnessDecision,
  dmDocument,
  dmDocumentVersion,
  dmIngressPreflight,
  dmPublicationFamily,
  dmSourceArtifact,
} from '@server/database/schema';

function fail(code: string, message: string, details: Record<string, unknown> = {}) {
  throw Object.assign(new Error(message), { code, details });
}

function asDate(value: string | Date) {
  return value instanceof Date ? value : new Date(value);
}

function parseJson(value: string) {
  return JSON.parse(value);
}

@Injectable()
// Registered by DocumentManagementHostedModule.register().
// eslint-disable-next-line @darraghor/nestjs-typed/injectable-should-be-provided
export class MiaodaHostedDocumentCatalog {
  constructor(
    @Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase,
  ) {}

  private async finalizeCatalogLinks(command) {
    const acquisitionUpdate = await this.db.update(dmAcquisition).set({
      documentVersionId: command.documentVersion.documentVersionId,
      status: 'COMMITTED_CANONICAL',
    }).where(and(
      eq(dmAcquisition.acquisitionId, command.documentVersion.acquisitionId),
      isNull(dmAcquisition.documentVersionId),
    )).returning({ acquisitionId: dmAcquisition.acquisitionId });
    if (acquisitionUpdate.length !== 1) {
      const [freshAcquisition] = await this.db.select().from(dmAcquisition).where(
        eq(dmAcquisition.acquisitionId, command.documentVersion.acquisitionId),
      ).limit(1);
      if (freshAcquisition?.documentVersionId !== command.documentVersion.documentVersionId) {
        fail('ACQUISITION_VERSION_CONFLICT', 'Acquisition did not link to committed DocumentVersion.');
      }
    }
    const preflightUpdate = await this.db.update(dmIngressPreflight).set({
      status: 'COMMITTED',
      documentVersionId: command.documentVersion.documentVersionId,
      commitIdempotencyKey: command.idempotencyKey,
      committedAt: asDate(command.documentVersion.committedAt),
    }).where(and(
      eq(dmIngressPreflight.preflightId, command.preflightId),
      eq(dmIngressPreflight.status, 'READY'),
    )).returning({ preflightId: dmIngressPreflight.preflightId });
    if (preflightUpdate.length !== 1) {
      const [freshPreflight] = await this.db.select().from(dmIngressPreflight).where(
        eq(dmIngressPreflight.preflightId, command.preflightId),
      ).limit(1);
      if (
        freshPreflight?.documentVersionId !== command.documentVersion.documentVersionId
        || freshPreflight.commitIdempotencyKey !== command.idempotencyKey
      ) {
        fail('PREFLIGHT_COMMIT_CONFLICT', 'Preflight did not finalize under the commit identity.');
      }
    }
  }

  async findIngestionByIdempotency({ idempotencyKey, sourceChannel, sourceRef, selection }) {
    const [acquisition] = await this.db.select().from(dmAcquisition).where(
      eq(dmAcquisition.idempotencyKey, idempotencyKey),
    ).limit(1);
    if (!acquisition) return null;
    const selectionBucketId = String(selection?.bucketId || selection?.bucket_id || '').trim();
    const selectionFilePath = String(selection?.filePath || selection?.file_path || '').trim();
    if (
      acquisition.sourceChannel !== String(sourceChannel || '').trim()
      || acquisition.sourceRef !== String(sourceRef || '').trim()
      || acquisition.selectionBucketId !== selectionBucketId
      || acquisition.selectionFilePath !== selectionFilePath
    ) {
      fail('ACQUISITION_IDEMPOTENCY_CONFLICT', 'Idempotency key was reused for another selection.');
    }
    if (!acquisition.documentVersionId) {
      return { status: 'INCOMPLETE', acquisitionId: acquisition.acquisitionId };
    }
    const rows = await this.db.select({
      version: dmDocumentVersion,
      family: dmPublicationFamily,
      artifact: dmSourceArtifact,
      preflight: dmIngressPreflight,
    }).from(dmDocumentVersion).innerJoin(
      dmPublicationFamily,
      eq(dmPublicationFamily.familyId, dmDocumentVersion.familyId),
    ).innerJoin(
      dmSourceArtifact,
      eq(dmSourceArtifact.sourceArtifactId, dmDocumentVersion.sourceArtifactId),
    ).innerJoin(
      dmIngressPreflight,
      and(
        eq(dmIngressPreflight.acquisitionId, acquisition.acquisitionId),
        eq(dmIngressPreflight.status, 'COMMITTED'),
      ),
    ).where(eq(
      dmDocumentVersion.documentVersionId,
      acquisition.documentVersionId,
    )).limit(2);
    if (rows.length !== 1 || rows[0].artifact.readbackVerified !== true) {
      fail('CATALOG_REPLAY_READ_FAILED', 'Completed replay lacks one fresh exact Catalog lineage.');
    }
    const row = rows[0];
    return {
      status: 'COMMITTED',
      acquisitionId: acquisition.acquisitionId,
      sourceArtifactId: acquisition.sourceArtifactId,
      preflightId: row.preflight.preflightId,
      decision: row.preflight.decision,
      familyId: row.family.familyId,
      documentId: row.version.documentId,
      documentVersionId: row.version.documentVersionId,
      currentGeneration: row.family.currentGeneration,
      immutableReadbackVerified: true,
    };
  }

  async recordAcquisition({ sourceArtifact, acquisition }) {
    await this.db.insert(dmSourceArtifact).values({
      ...sourceArtifact,
      createdAt: asDate(sourceArtifact.createdAt),
    }).onConflictDoNothing({ target: dmSourceArtifact.sourceArtifactId });
    const [storedArtifact] = await this.db.select().from(dmSourceArtifact).where(
      eq(dmSourceArtifact.sourceArtifactId, sourceArtifact.sourceArtifactId),
    ).limit(1);
    if (
      !storedArtifact
      || storedArtifact.sha256 !== sourceArtifact.sha256
      || Number(storedArtifact.byteLength) !== Number(sourceArtifact.byteLength)
      || storedArtifact.bucketId !== sourceArtifact.bucketId
      || storedArtifact.filePath !== sourceArtifact.filePath
    ) {
      fail('SOURCE_ARTIFACT_IDENTITY_CONFLICT', 'SourceArtifact identity drifted in hosted Catalog.');
    }

    await this.db.insert(dmAcquisition).values({
      acquisitionId: acquisition.acquisitionId,
      sourceArtifactId: acquisition.sourceArtifactId,
      sourceChannel: acquisition.sourceChannel,
      sourceRef: acquisition.sourceRef,
      selectionBucketId: acquisition.selectionBucketId,
      selectionFilePath: acquisition.selectionFilePath,
      providerObjectId: acquisition.providerObjectId,
      providerVersionId: acquisition.providerVersionId,
      acquiredBy: acquisition.acquiredBy,
      acquiredAt: asDate(acquisition.acquiredAt),
      idempotencyKey: acquisition.idempotencyKey,
      sourceDescriptorJson: JSON.stringify(acquisition.sourceDescriptor),
      status: 'ACQUIRED_READBACK_VERIFIED',
    }).onConflictDoNothing({ target: dmAcquisition.idempotencyKey });
    const [stored] = await this.db.select().from(dmAcquisition).where(
      eq(dmAcquisition.idempotencyKey, acquisition.idempotencyKey),
    ).limit(1);
    if (!stored || stored.acquisitionId !== acquisition.acquisitionId) {
      fail('ACQUISITION_IDEMPOTENCY_CONFLICT', 'Idempotency key resolved to another Acquisition.');
    }
    return {
      ...stored,
      sourceDescriptor: parseJson(stored.sourceDescriptorJson),
    };
  }

  async listIngressDocuments() {
    const rows = await this.db.select({
      version: dmDocumentVersion,
      family: dmPublicationFamily,
    }).from(dmDocumentVersion).innerJoin(
      dmPublicationFamily,
      eq(dmDocumentVersion.familyId, dmPublicationFamily.familyId),
    );
    return rows.map(({ version, family }) => ({
      documentId: version.documentId,
      documentVersionId: version.documentVersionId,
      familyId: version.familyId,
      versionStatus: family.currentDocumentVersionId === version.documentVersionId
        ? 'CANONICAL_CURRENT'
        : 'CANONICAL_HISTORICAL',
      detail: {
        sha256: version.pdfSha256,
        sizeBytes: Number(version.byteLength),
        documentCode: family.canonicalDocumentNumber,
        originalFilename: version.originalFilename,
        documentFamily: family.documentFamily,
        canonicalDocumentFamily: family.documentFamily,
        businessRevision: version.businessRevision,
        revisionDate: version.revisionDate,
        sourceGeneratedDate: version.sourceGeneratedDate,
        revisionId: version.revisionId,
        status: 'catalog_committed',
      },
      upload: {
        descriptorSummary: {
          sha256: version.pdfSha256,
          sizeBytes: Number(version.byteLength),
          documentCode: family.canonicalDocumentNumber,
          documentFamily: family.documentFamily,
          businessRevision: version.businessRevision,
          revisionDate: version.revisionDate,
          sourceGeneratedDate: version.sourceGeneratedDate,
        },
      },
      report: { status: 'not_available' },
      ownerActionState: { pipeline: { selectedReplacementRevisionId: '' } },
      documentAnalysisWorkbenchView: { status: 'not_available' },
    }));
  }

  async observeFamily(canonicalIdentityKey: string) {
    const [family] = await this.db.select().from(dmPublicationFamily).where(
      eq(dmPublicationFamily.canonicalIdentityKey, canonicalIdentityKey),
    ).limit(1);
    return family || null;
  }

  async recordPreflight(preflight) {
    await this.db.insert(dmIngressPreflight).values({
      preflightId: preflight.preflightId,
      acquisitionId: preflight.acquisitionId,
      decision: preflight.decision,
      branch: preflight.branch,
      executionAuthorized: false,
      observedCurrentGeneration: preflight.observedCurrentGeneration,
      observedCurrentDocumentVersionId: preflight.observedCurrentDocumentVersionId,
      normalizedDescriptorJson: JSON.stringify(preflight.normalizedDescriptor),
      decisionPayloadJson: JSON.stringify(preflight.decisionPayload),
      status: preflight.status,
      createdAt: asDate(preflight.createdAt),
    }).onConflictDoNothing({ target: dmIngressPreflight.preflightId });
    const [stored] = await this.db.select().from(dmIngressPreflight).where(
      eq(dmIngressPreflight.preflightId, preflight.preflightId),
    ).limit(1);
    return stored;
  }

  async findExactDocumentVersion({ sha256, byteLength }) {
    const matches = await this.db.select().from(dmDocumentVersion).where(and(
      eq(dmDocumentVersion.pdfSha256, sha256),
      eq(dmDocumentVersion.byteLength, Number(byteLength)),
    )).limit(2);
    if (matches.length > 1) {
      fail('MULTIPLE_EXACT_MATCHES', 'Content identity resolved to multiple DocumentVersions.');
    }
    return matches[0] || null;
  }

  async linkAcquisitionToVersion({
    acquisitionId,
    documentVersionId,
    preflightId,
    idempotencyKey,
  }) {
    const [current] = await this.db.select().from(dmAcquisition).where(
      eq(dmAcquisition.acquisitionId, acquisitionId),
    ).limit(1);
    if (!current) fail('ACQUISITION_NOT_FOUND', `Acquisition not found: ${acquisitionId}`);
    if (current.documentVersionId && current.documentVersionId !== documentVersionId) {
      fail('ACQUISITION_VERSION_CONFLICT', 'Acquisition is already linked to another DocumentVersion.');
    }
    const [updated] = await this.db.update(dmAcquisition).set({
      documentVersionId,
      status: 'LINKED_EXACT_DOCUMENT_VERSION',
    }).where(and(
      eq(dmAcquisition.acquisitionId, acquisitionId),
      current.documentVersionId
        ? eq(dmAcquisition.documentVersionId, current.documentVersionId)
        : isNull(dmAcquisition.documentVersionId),
    )).returning();
    if (!updated && current.documentVersionId !== documentVersionId) {
      fail('ACQUISITION_LINK_CAS_CONFLICT', 'Acquisition link changed concurrently.');
    }
    const preflightUpdate = await this.db.update(dmIngressPreflight).set({
      status: 'COMMITTED',
      documentVersionId,
      commitIdempotencyKey: idempotencyKey,
      committedAt: new Date(),
    }).where(and(
      eq(dmIngressPreflight.preflightId, preflightId),
      eq(dmIngressPreflight.acquisitionId, acquisitionId),
      eq(dmIngressPreflight.status, 'READY'),
    )).returning({ preflightId: dmIngressPreflight.preflightId });
    if (preflightUpdate.length !== 1) {
      const [freshPreflight] = await this.db.select().from(dmIngressPreflight).where(
        eq(dmIngressPreflight.preflightId, preflightId),
      ).limit(1);
      if (
        freshPreflight?.documentVersionId !== documentVersionId
        || freshPreflight.commitIdempotencyKey !== idempotencyKey
      ) {
        fail('PREFLIGHT_COMMIT_CONFLICT', 'Exact-link preflight did not finalize idempotently.');
      }
    }
    return updated || current;
  }

  async commitNewVersion(command) {
    const [storedPreflight] = await this.db.select().from(dmIngressPreflight).where(
      eq(dmIngressPreflight.preflightId, command.preflightId),
    ).limit(1);
    if (!storedPreflight) fail('PREFLIGHT_NOT_FOUND', `Preflight not found: ${command.preflightId}`);
    if (
      storedPreflight.decision !== command.preflightDecision
      || storedPreflight.observedCurrentGeneration !== command.observedCurrentGeneration
      || (storedPreflight.observedCurrentDocumentVersionId || null)
        !== (command.observedCurrentDocumentVersionId || null)
    ) {
      fail('PREFLIGHT_COMMAND_MISMATCH', 'Commit command differs from stored preflight observation.');
    }
    if (storedPreflight.executionAuthorized !== false) {
      fail('PREFLIGHT_AUTHORITY_VIOLATION', 'Preflight cannot authorize its own execution.');
    }
    if (storedPreflight.status === 'COMMITTED' && storedPreflight.documentVersionId) {
      const version = await this.readDocumentVersion(storedPreflight.documentVersionId);
      const family = version ? await this.readFamily(version.familyId) : null;
      if (!version || !family) fail('CATALOG_REPLAY_READ_FAILED', 'Committed replay lacks fresh Catalog rows.');
      return {
        disposition: 'IDEMPOTENT_REPLAY',
        familyId: family.familyId,
        documentId: version.documentId,
        documentVersionId: version.documentVersionId,
        currentnessChanged: false,
        currentGeneration: family.currentGeneration,
      };
    }

    let [familyBefore] = await this.db.select().from(dmPublicationFamily).where(
      eq(dmPublicationFamily.familyId, command.family.familyId),
    ).limit(1);
    if (familyBefore && familyBefore.canonicalIdentityKey !== command.family.canonicalIdentityKey) {
      fail('FAMILY_IDENTITY_CONFLICT', 'Family ID resolved to another canonical identity.');
    }
    const [sameRevision] = await this.db.select().from(dmDocumentVersion).where(and(
      eq(dmDocumentVersion.familyId, command.family.familyId),
      eq(
        dmDocumentVersion.canonicalRevisionIdentity,
        command.documentVersion.canonicalRevisionIdentity,
      ),
    )).limit(1);
    if (
      sameRevision
      && (
        sameRevision.pdfSha256 !== command.documentVersion.pdfSha256
        || Number(sameRevision.byteLength) !== Number(command.documentVersion.byteLength)
      )
    ) {
      fail('SAME_REVISION_CONTENT_CONFLICT', 'Exact revision already has different actual bytes.');
    }
    if (sameRevision) {
      const [currentness] = await this.db.select().from(dmCurrentnessDecision).where(
        eq(
          dmCurrentnessDecision.currentnessDecisionId,
          command.currentnessDecision.currentnessDecisionId,
        ),
      ).limit(1);
      const committedBeforeLink = Boolean(
        familyBefore
        && familyBefore.currentDocumentVersionId === sameRevision.documentVersionId
        && familyBefore.currentGeneration === command.observedCurrentGeneration + 1
        && currentness?.nextDocumentVersionId === sameRevision.documentVersionId
        && currentness.previousGeneration === command.observedCurrentGeneration
      );
      if (!committedBeforeLink) {
        fail(
          'DOCUMENT_VERSION_ALREADY_EXISTS_NOT_CURRENT',
          'Exact revision exists but is not the currentness commit owned by this preflight.',
        );
      }
      await this.finalizeCatalogLinks(command);
      return {
        disposition: 'IDEMPOTENT_REPLAY',
        familyId: command.family.familyId,
        documentId: sameRevision.documentId,
        documentVersionId: sameRevision.documentVersionId,
        currentnessChanged: false,
        currentGeneration: familyBefore.currentGeneration,
      };
    }
    const familyCreatedInCommand = !familyBefore;
    if (familyCreatedInCommand) {
      const insertedFamily = this.db.$with('inserted_publication_family').as(
        this.db.insert(dmPublicationFamily).values({
          ...command.family,
          currentDocumentVersionId: null,
          currentGeneration: 0,
          createdAt: asDate(command.family.createdAt),
          updatedAt: asDate(command.family.createdAt),
        }).onConflictDoNothing({ target: dmPublicationFamily.familyId }).returning({
          familyId: dmPublicationFamily.familyId,
        }),
      );
      const insertedDocument = this.db.$with('inserted_document').as(
        this.db.insert(dmDocument).select(
          this.db.select({
            documentId: sql<string>`${command.document.documentId}`.as('document_id'),
            familyId: insertedFamily.familyId,
            documentFamily: sql<string>`${command.document.documentFamily}`.as('document_family'),
            status: sql<string>`${command.document.status}`.as('status'),
            createdAt: sql<Date>`${asDate(command.document.createdAt)}`.as('created_at'),
          }).from(insertedFamily),
        ).returning({ familyId: dmDocument.familyId }),
      );
      const created = await this.db.with(insertedFamily, insertedDocument).select({
        familyId: insertedFamily.familyId,
      }).from(insertedFamily).innerJoin(
        insertedDocument,
        eq(insertedDocument.familyId, insertedFamily.familyId),
      );
      if (created.length !== 1) {
        fail('FAMILY_CREATE_CONFLICT', 'Family/Document creation did not commit as one hosted statement.');
      }
      [familyBefore] = await this.db.select().from(dmPublicationFamily).where(
        eq(dmPublicationFamily.familyId, command.family.familyId),
      ).limit(1);
    }
    if (!familyBefore) fail('FAMILY_NOT_FOUND', 'Hosted Family was not available for currentness CAS.');
    const moved = this.db.$with('moved_family_head').as(
      this.db.update(dmPublicationFamily).set({
        currentDocumentVersionId: command.documentVersion.documentVersionId,
        currentGeneration: command.observedCurrentGeneration + 1,
        updatedAt: asDate(command.documentVersion.committedAt),
      }).where(and(
        eq(dmPublicationFamily.familyId, command.family.familyId),
        eq(dmPublicationFamily.currentGeneration, command.observedCurrentGeneration),
        command.observedCurrentDocumentVersionId
          ? eq(
            dmPublicationFamily.currentDocumentVersionId,
            command.observedCurrentDocumentVersionId,
          )
          : isNull(dmPublicationFamily.currentDocumentVersionId),
      )).returning({ familyId: dmPublicationFamily.familyId }),
    );
    const insertedVersion = this.db.$with('inserted_document_version').as(
      this.db.insert(dmDocumentVersion).select(
        this.db.select({
          documentVersionId: sql<string>`${command.documentVersion.documentVersionId}`.as('document_version_id'),
          documentId: sql<string>`${command.documentVersion.documentId}`.as('document_id'),
          familyId: moved.familyId,
          revisionId: sql<string>`${command.documentVersion.revisionId}`.as('revision_id'),
          canonicalRevisionIdentity: sql<string>`${command.documentVersion.canonicalRevisionIdentity}`.as('canonical_revision_identity'),
          businessRevision: sql<string>`${command.documentVersion.businessRevision}`.as('business_revision'),
          revisionDate: sql<string>`${command.documentVersion.revisionDate}`.as('revision_date'),
          sourceGeneratedDate: sql<string>`${command.documentVersion.sourceGeneratedDate}`.as('source_generated_date'),
          originalFilename: sql<string>`${command.documentVersion.originalFilename}`.as('original_filename'),
          sourceArtifactId: sql<string>`${command.documentVersion.sourceArtifactId}`.as('source_artifact_id'),
          acquisitionId: sql<string>`${command.documentVersion.acquisitionId}`.as('acquisition_id'),
          pdfSha256: sql<string>`${command.documentVersion.pdfSha256}`.as('pdf_sha256'),
          byteLength: sql<number>`${command.documentVersion.byteLength}`.as('byte_length'),
          mediaType: sql<string>`${command.documentVersion.mediaType}`.as('media_type'),
          lifecycleStatus: sql<string>`COMMITTED_IMMUTABLE`.as('lifecycle_status'),
          committedAt: sql<Date>`${asDate(command.documentVersion.committedAt)}`.as('committed_at'),
          committedBy: sql<string>`${command.documentVersion.committedBy}`.as('committed_by'),
        }).from(moved),
      ).returning({
        documentVersionId: dmDocumentVersion.documentVersionId,
        familyId: dmDocumentVersion.familyId,
      }),
    );
    const movedRows = await this.db.with(moved, insertedVersion).insert(dmCurrentnessDecision).select(
      this.db.select({
        currentnessDecisionId: sql<string>`${command.currentnessDecision.currentnessDecisionId}`.as('currentness_decision_id'),
        familyId: moved.familyId,
        previousDocumentVersionId: sql<string | null>`${command.observedCurrentDocumentVersionId}`.as('previous_document_version_id'),
        nextDocumentVersionId: sql<string>`${command.documentVersion.documentVersionId}`.as('next_document_version_id'),
        previousGeneration: sql<number>`${command.observedCurrentGeneration}`.as('previous_generation'),
        nextGeneration: sql<number>`${command.observedCurrentGeneration + 1}`.as('next_generation'),
        reason: sql<string>`${command.currentnessDecision.reason}`.as('reason'),
        decidedAt: sql<Date>`${asDate(command.currentnessDecision.decidedAt)}`.as('decided_at'),
        decidedBy: sql<string>`${command.currentnessDecision.decidedBy}`.as('decided_by'),
        preflightId: sql<string>`${command.preflightId}`.as('preflight_id'),
      }).from(moved).innerJoin(
        insertedVersion,
        eq(insertedVersion.familyId, moved.familyId),
      ),
    ).returning();
    if (movedRows.length !== 1) {
      fail('CURRENTNESS_CAS_CONFLICT', 'Family current head changed after preflight.');
    }

    await this.finalizeCatalogLinks(command);
    return {
      disposition: command.preflightDecision,
      familyId: command.family.familyId,
      documentId: command.document.documentId,
      documentVersionId: command.documentVersion.documentVersionId,
      currentnessChanged: true,
      currentGeneration: command.observedCurrentGeneration + 1,
    };
  }

  async readDocumentVersion(documentVersionId: string) {
    const [version] = await this.db.select().from(dmDocumentVersion).where(
      eq(dmDocumentVersion.documentVersionId, documentVersionId),
    ).limit(1);
    return version || null;
  }

  async readFamily(familyId: string) {
    const [family] = await this.db.select().from(dmPublicationFamily).where(
      eq(dmPublicationFamily.familyId, familyId),
    ).limit(1);
    return family || null;
  }
}
