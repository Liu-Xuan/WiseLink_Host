import type {
  TdmsArtifactSelection,
  TdmsFileServiceRecordReadResponse,
} from '@shared/tdms-file-service-import.interface';
import type { TdmsPackageArtifact } from '@shared/tdms-source.interface';
import { fileServiceImport } from './tdms-file-service-import.validation';
import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type {
  TdmsArtifactBinding,
  TdmsCatalogueResponse,
  TdmsExactEndpoint,
  TdmsHistoryEntry,
  TdmsHistoryResponse,
  TdmsImportReceipt,
  TdmsPackageEndpoint,
  TdmsReadContext,
  TdmsReadReceipt,
  TdmsRecordReadResponse,
  TdmsRecordRevision,
  TdmsRecordSummary,
  TdmsRelationAssertion,
  TdmsRelationReadResponse,
  TdmsSourcePackage,
} from '@shared/tdms-source.interface';
import { assertPublicActor, sameScope } from './tdms-source.authorization';
import {
  prepareTdmsDailyMetadataImport,
  type TdmsDailyMetadataImportReceipt,
} from './tdms-daily-metadata-contract';
import {
  assertSameDailyEnvelope,
  dailyReferenceRead,
  dailyRequestId,
  dailySourceRef,
  storedDailyCapture,
} from './tdms-daily-metadata.readback';
import {
  assertOpinionCollectionIngress,
  canonical,
  hash,
  identifier,
  object,
  packageGaps,
  readContext,
  relationVerificationGaps,
  sourcePackage,
  strict,
} from './tdms-source.validation';
import {
  TDMS_ARTIFACT_STORE,
  TDMS_DOCUMENT_ACCESS,
  TDMS_REPOSITORY,
  TDMS_SOURCE_AUTHORIZATION,
  tdmsError,
  type TdmsArtifactStore,
  type TdmsCapture,
  type TdmsDocumentAccess,
  type TdmsPublicActor,
  type TdmsImportAdmission,
  type TdmsImportMemberClaims,
  type TdmsReadMemberAdmission,
  type TdmsRepository,
  type TdmsSourceAuthorization,
  type TdmsSourceGrant,
  type TdmsSourceScope,
  type TdmsStoredRevision,
  type TdmsTransaction,
} from './tdms-source.types';

type PreparedSourcePackage = Omit<TdmsSourcePackage, 'artifacts'> & {
  artifacts: Array<TdmsPackageArtifact | TdmsArtifactSelection>;
};
type TdmsEndpointReadDependency = {
  documentVersionIds: string[];
  grant?: TdmsSourceGrant;
};
const LIMITATIONS = [
  'SOURCE_DECLARED_NOT_INDEPENDENTLY_VERIFIED',
  'SELECTED_HOST_OBSERVATION_NOT_LATEST_OFFICIAL_PUBLICATION',
  'NO_ENGINEERING_ADOPTION_OR_EXECUTION_VERIFICATION',
  'LCM_CONFIGURATION_AUTHORITY_NOT_CONNECTED',
];
@Injectable()
export class TdmsSourceService {
  constructor(
    @Inject(TDMS_REPOSITORY) private readonly repository: TdmsRepository,
    @Inject(TDMS_SOURCE_AUTHORIZATION)
    private readonly authorization: TdmsSourceAuthorization,
    @Inject(TDMS_ARTIFACT_STORE) private readonly artifacts: TdmsArtifactStore,
    @Inject(TDMS_DOCUMENT_ACCESS)
    private readonly documents: TdmsDocumentAccess,
  ) {}

  async importDailyMetadata(actor: TdmsPublicActor, raw: unknown) {
    assertPublicActor(actor);
    this.requireDailyAuthorization();
    const prepared = prepareTdmsDailyMetadataImport(raw);
    const grants = await this.dailyGrants(actor);
    if (grants.length !== 1)
      throw tdmsError('TDMS_DAILY_SOURCE_SCOPE_AMBIGUOUS', 409);
    const scope = grants[0]!.scope;
    const admission = await this.authorization.authorizeImport(
      actor,
      scope,
      prepared.memberClaims,
    );
    this.assertImportAdmission(actor, admission, scope, prepared.memberClaims);
    const receipt = await this.repository.transaction(async (tx) => {
      await this.recheckImport(actor, admission, prepared.memberClaims);
      const prior = await tx.capture(scope, prepared.envelope.requestId);
      if (prior) {
        const saved = storedDailyCapture(prior, actor, scope, true);
        assertSameDailyEnvelope(saved, prepared);
        return saved.receipt;
      }
      const now = new Date().toISOString();
      const receipt: TdmsDailyMetadataImportReceipt = {
        schemaVersion: 'wiselink.tdms-source-import-receipt.v1',
        requestId: prepared.envelope.requestId,
        payloadDigest: prepared.payloadDigest,
        status: 'IMPORTED',
        importedAt: now,
        sourceRefs: prepared.sourceRefs,
        objectCount: prepared.envelope.package.records.length,
        relationCount: prepared.envelope.package.edges.length,
        artifactCount: 0,
        documentVersionMappings: [],
      };
      await tx.saveCapture({
        scope,
        // Existing scope/request uniqueness is the only persistence CAS.
        packageId: prepared.envelope.requestId,
        packageHash: prepared.payloadDigest,
        actorId: actor.canonicalSubject.id,
        capturedAt: now,
        permissionRevision: admission.permissionRevision,
        admissionAuthorityRef: admission.authorityRef,
        query: prepared.envelope.package.query as TdmsSourcePackage['query'],
        // Private legacy capture header; no native projection is created or served as this receipt.
        receipt: {
          captureRef: 'TDMS-CAP-' + randomUUID(),
          packageId: prepared.envelope.package.packageId,
          status: 'PARTIAL',
          created: true,
          sourceVerification: 'DECLARED_ONLY',
          recordRevisionRefs: [],
          assertionRefs: [],
          artifactBindings: [],
          gaps: ['DAILY_METADATA_ONLY_NO_NATIVE_PROJECTION'],
          engineeringAdoption: 'NOT_CREATED',
          executionVerified: false,
        },
        dailyMetadata: {
          applicationScopeId: actor.applicationScopeId,
          envelope: prepared.envelope,
          receipt,
        },
      });
      const stored = await tx.capture(scope, prepared.envelope.requestId);
      if (!stored) throw tdmsError('TDMS_DAILY_CAPTURE_READBACK_FAILED', 409);
      const saved = storedDailyCapture(stored, actor, scope, true);
      assertSameDailyEnvelope(saved, prepared);
      await this.recheckImport(actor, admission, prepared.memberClaims);
      return saved.receipt;
    });
    await this.recheckImport(actor, admission, prepared.memberClaims);
    return receipt;
  }

  async readDailyMetadataImport(actor: TdmsPublicActor, requestId: string) {
    assertPublicActor(actor);
    dailyRequestId(requestId);
    const grants = await this.dailyGrants(actor);
    const { row, grant } = await this.dailyCaptureLookup(
      actor,
      grants,
      'READ_HISTORY',
      async (tx, scope) => {
        const row = await tx.capture(scope, requestId);
        return row ? [row] : [];
      },
    );
    const saved = storedDailyCapture(row, actor, grant.scope, true);
    if (saved.envelope.requestId !== requestId)
      throw tdmsError('TDMS_DAILY_CAPTURE_INTEGRITY_CONFLICT', 409);
    await this.checkDailyReadMembers(
      actor,
      grant,
      'READ_HISTORY',
      saved.memberClaims,
    );
    return { receipt: saved.receipt, package: saved.envelope.package };
  }

  async readDailySourceRef(actor: TdmsPublicActor, sourceRef: string) {
    assertPublicActor(actor);
    dailySourceRef(sourceRef);
    const grants = await this.dailyGrants(actor);
    const { row, grant } = await this.dailyCaptureLookup(
      actor,
      grants,
      'READ_RECORD',
      (tx, scope) => tx.capturesBySourceRef(scope, sourceRef),
    );
    const saved = storedDailyCapture(row, actor, grant.scope, false);
    if (!saved.receipt.sourceRefs.includes(sourceRef))
      throw tdmsError('TDMS_DAILY_CAPTURE_INTEGRITY_CONFLICT', 409);
    const read = dailyReferenceRead(saved.envelope.package, sourceRef);
    await this.checkDailyReadMembers(actor, grant, 'READ_RECORD', read.claims);
    return read.response;
  }

  private requireDailyAuthorization() {
    if (!this.authorization.available)
      throw tdmsError('TDMS_SOURCE_AUTHORIZATION_UNCONFIGURED', 503);
  }
  private async dailyGrants(actor: TdmsPublicActor) {
    this.requireDailyAuthorization();
    const grants = await this.authorization.catalogue(actor, {});
    const result: TdmsSourceGrant[] = [];
    for (const grant of grants) {
      this.assertGrant(actor, grant);
      if (grant.scope.sourceKey !== 'TDMS') continue;
      const existing = result.find((g) => sameScope(g.scope, grant.scope));
      if (existing && existing.permissionRevision !== grant.permissionRevision)
        throw tdmsError('TDMS_SOURCE_PERMISSION_CHANGED', 409);
      if (!existing) result.push(grant);
    }
    if (!result.length) throw tdmsError('TDMS_SOURCE_NOT_FOUND', 404);
    return result;
  }
  private async dailyCaptureLookup(
    actor: TdmsPublicActor,
    grants: TdmsSourceGrant[],
    action: 'READ_RECORD' | 'READ_HISTORY',
    lookup: (
      tx: TdmsTransaction,
      scope: TdmsSourceScope,
    ) => Promise<TdmsCapture[]>,
  ) {
    if (!this.authorization.authorizeReadMembers)
      throw tdmsError('TDMS_READ_MEMBER_ADMISSION_UNCONFIGURED', 503);
    return this.repository.transaction(async (tx) => {
      const matches: Array<{
        row: TdmsCapture;
        grant: TdmsSourceGrant;
      }> = [];
      for (const grant of grants) {
        await this.recheck(actor, grant, action, {});
        for (const row of await lookup(tx, grant.scope))
          matches.push({ row, grant });
        await this.recheck(actor, grant, action, {});
      }
      if (!matches.length) throw tdmsError('TDMS_SOURCE_NOT_FOUND', 404);
      // Never choose a scope, package, head or latest observation on the caller's behalf.
      if (matches.length !== 1)
        throw tdmsError('TDMS_DAILY_REFERENCE_AMBIGUOUS', 409);
      return matches[0]!;
    });
  }
  private async checkDailyReadMembers(
    actor: TdmsPublicActor,
    grant: TdmsSourceGrant,
    action: 'READ_RECORD' | 'READ_HISTORY',
    claims: TdmsImportMemberClaims,
  ) {
    const authorize = this.authorization.authorizeReadMembers;
    if (!authorize)
      throw tdmsError('TDMS_READ_MEMBER_ADMISSION_UNCONFIGURED', 503);
    const check = (admission: TdmsReadMemberAdmission) => {
      this.assertGrant(actor, admission, grant.scope);
      const allowed = admission.permittedMembers;
      if (
        !admission.authorityRef ||
        admission.retainedCaptureReadAllowed !== true ||
        !allowed ||
        !Array.isArray(allowed.records) ||
        !Array.isArray(allowed.relationIds) ||
        claims.records.some(
          (r) =>
            !allowed.records.some(
              (a) =>
                a.recordKind === r.recordKind &&
                a.sourceRecordId === r.sourceRecordId,
            ),
        ) ||
        claims.relationIds.some((id) => !allowed.relationIds.includes(id))
      )
        throw tdmsError('TDMS_READ_MEMBER_SCOPE_ADMISSION_REQUIRED', 403);
      if (admission.permissionRevision !== grant.permissionRevision)
        throw tdmsError('TDMS_SOURCE_PERMISSION_CHANGED', 409);
    };
    const first = await authorize.call(
      this.authorization,
      actor,
      grant.scope,
      action,
      claims,
    );
    check(first);
    await this.recheck(actor, grant, action, {});
    const fresh = await authorize.call(
      this.authorization,
      actor,
      grant.scope,
      action,
      claims,
    );
    check(fresh);
    if (first.authorityRef !== fresh.authorityRef)
      throw tdmsError('TDMS_SOURCE_PERMISSION_CHANGED', 409);
  }

  async catalogue(
    actor: TdmsPublicActor,
    contextValue: TdmsReadContext = {},
    after?: string,
  ): Promise<TdmsCatalogueResponse> {
    assertPublicActor(actor);
    const context = readContext(contextValue);
    if (after !== undefined) identifier(after);
    const grants = await this.authorization.catalogue(actor, context);
    if (!grants.length)
      return {
        records: [],
        sourceStatus: 'DISABLED',
        hasMore: false,
        nextAfter: null,
        readPerformed: false,
        limitations: [
          ...LIMITATIONS,
          'TDMS_SOURCE_AUTHORIZATION_UNCONFIGURED_OR_UNAVAILABLE',
        ],
      };
    const result = await this.repository.transaction(async (tx) => {
      const records: TdmsRecordSummary[] = [];
      for (const grant of grants) {
        this.assertGrant(actor, grant);
        await this.recheck(actor, grant, 'CATALOGUE', context);
        for (const row of await tx.catalogue(grant.scope)) {
          if (!sameScope(row.scope, grant.scope))
            throw tdmsError('TDMS_STORED_SCOPE_MISMATCH', 409);
          await this.assertRelatedDocuments(actor, row.record);
          records.push(summary(row.record));
        }
        await this.recheck(actor, grant, 'CATALOGUE', context);
      }
      records.sort((a, b) =>
        a.sourceRevisionRef.localeCompare(b.sourceRevisionRef),
      );
      const window = records
        .filter((r) => !after || r.sourceRevisionRef > after)
        .slice(0, 51);
      return {
        // The lookahead member also determines released pagination metadata.
        documentVersionIds: window.flatMap(r => r.relatedDocumentVersionIds),
        response: {
          records: window.slice(0, 50),
          sourceStatus: 'AVAILABLE' as const,
          hasMore: window.length > 50,
          nextAfter: window.length > 50 ? window[49]!.sourceRevisionRef : null,
          readPerformed: false as const,
          limitations: [...LIMITATIONS],
        },
      };
    });
    for (const id of result.documentVersionIds)
      await this.documents.assertRead(actor, id);
    for (const g of grants) await this.recheck(actor, g, 'CATALOGUE', context);
    return result.response;
  }
  async readRecord(
    actor: TdmsPublicActor,
    refValue: string,
    contextValue: TdmsReadContext = {},
  ): Promise<TdmsFileServiceRecordReadResponse> {
    assertPublicActor(actor);
    const ref = identifier(refValue),
      context = readContext(contextValue);
    if (!this.authorization.available)
      throw tdmsError('TDMS_SOURCE_AUTHORIZATION_UNCONFIGURED', 503);
    const result = await this.repository.transaction(async (tx) => {
      const row = await this.authorizedRevision(
        tx,
        actor,
        ref,
        'READ_RECORD',
        context,
      );
      await this.assertRelatedDocuments(actor, row.stored.record);
      const receipt = this.receipt(
        ref,
        'WIKI_NATIVE_RECORD',
        row.grant,
        context,
      );
      await this.recheck(actor, row.grant, 'READ_RECORD', context);
      await tx.saveReceipt({
        scope: row.grant.scope,
        actorId: actor.canonicalSubject.id,
        receipt,
        context,
      });
      await this.recheck(actor, row.grant, 'READ_RECORD', context);
      return {
        grant: row.grant,
        response: {
          record: row.stored.record,
          selectedFields: null,
          ...(row.stored.attachmentAcquisitions?.length
            ? {
                attachmentAcquisitions: row.stored.attachmentAcquisitions.map(
                  (fact) => ({
                    ...fact,
                    currentSourcePermissionChecked: true as const,
                    semanticReadPerformed: false as const,
                    engineeringExecutionVerified: false as const,
                  }),
                ),
              }
            : {}),
          receipt,
          limitations: [...LIMITATIONS],
        } as TdmsFileServiceRecordReadResponse,
      };
    });
    await this.assertRelatedDocuments(actor, result.response.record);
    await this.recheck(actor, result.grant, 'READ_RECORD', context);
    return result.response;
  }
  async history(
    actor: TdmsPublicActor,
    refValue: string,
    contextValue: TdmsReadContext = {},
    after?: string,
  ): Promise<TdmsHistoryResponse> {
    assertPublicActor(actor);
    const ref = identifier(refValue);
    const context = readContext(contextValue);
    if (after !== undefined) identifier(after);
    if (!this.authorization.available)
      throw tdmsError('TDMS_SOURCE_AUTHORIZATION_UNCONFIGURED', 503);
    const result = await this.repository.transaction(async (tx) => {
      const root = await this.authorizedRevision(
        tx,
        actor,
        ref,
        'READ_HISTORY',
        context,
      );
      await this.assertRelatedDocuments(actor, root.stored.record);
      const record = root.stored.record;
      const head = await tx.recordHead(
        root.grant.scope,
        record.recordKind,
        record.sourceRecordId,
      );
      const visible: TdmsHistoryEntry[] = [];
      for (const row of await tx.history(root.grant.scope, record.recordRef)) {
        if (
          !sameScope(row.scope, root.grant.scope) ||
          row.record.recordRef !== record.recordRef ||
          row.record.recordKind !== record.recordKind ||
          row.record.sourceRecordId !== record.sourceRecordId
        )
          throw tdmsError('TDMS_STORED_SCOPE_MISMATCH', 409);
        try {
          await this.assertRelatedDocuments(actor, row.record);
        } catch (error) {
          if (isHiddenDocument(error)) continue;
          throw error;
        }
        await this.recheck(actor, root.grant, 'READ_HISTORY', context);
        visible.push({
          ...summary(row.record),
          captureRef: row.record.captureRef,
          sourceModifiedAt: row.record.sourceModifiedAt,
          selectedHead:
            head?.sourceRevisionRef === row.record.sourceRevisionRef,
        });
      }
      visible.sort((a, b) =>
        a.sourceRevisionRef.localeCompare(b.sourceRevisionRef),
      );
      const window = visible
        .filter((r) => !after || r.sourceRevisionRef > after)
        .slice(0, 51);
      await this.recheck(actor, root.grant, 'READ_HISTORY', context);
      return {
        grant: root.grant,
        rootDocumentVersionIds: record.relatedDocumentVersionIds,
        response: {
          recordRef: record.recordRef,
          versions: window.slice(0, 50),
          hasMore: window.length > 50,
          nextAfter: window.length > 50 ? window[49]!.sourceRevisionRef : null,
          readPerformed: false as const,
          limitations: [...LIMITATIONS],
        },
      };
    });
    // A linked DM grant can disappear after the native transaction. Never return stale page metadata.
    for (const id of [
      ...result.rootDocumentVersionIds,
      ...result.response.versions.flatMap((v) => v.relatedDocumentVersionIds),
    ])
      await this.documents.assertRead(actor, id);
    await this.recheck(actor, result.grant, 'READ_HISTORY', context);
    return result.response;
  }
  async readRelations(
    actor: TdmsPublicActor,
    refValue: string,
    contextValue: TdmsReadContext = {},
  ): Promise<TdmsRelationReadResponse> {
    assertPublicActor(actor);
    const ref = identifier(refValue),
      context = readContext(contextValue);
    if (!this.authorization.available)
      throw tdmsError('TDMS_SOURCE_AUTHORIZATION_UNCONFIGURED', 503);
    const result = await this.repository.transaction(async (tx) => {
      const root = await this.authorizedRevision(
        tx,
        actor,
        ref,
        'READ_RELATIONS',
        context,
      );
      await this.assertRelatedDocuments(actor, root.stored.record);
      const relations: TdmsRelationAssertion[] = [];
      const releaseDependencies: Array<{
        assertion: TdmsRelationAssertion;
        endpoints: TdmsEndpointReadDependency[];
      }> = [];
      for (const row of await tx.relations(actor.tenantId, ref)) {
        if (!sameScope(row.scope, root.grant.scope)) continue;
        // Both exact endpoints must be freshly readable. Denied neighbors do not leak titles/counts/adjacency.
        const endpoints: TdmsEndpointReadDependency[] = [];
        try {
          endpoints.push(await this.authorizeEndpoint(
            tx,
            actor,
            row.scope,
            row.assertion.from,
            context,
          ));
          endpoints.push(await this.authorizeEndpoint(
            tx,
            actor,
            row.scope,
            row.assertion.to,
            context,
          ));
        } catch (error) {
          if (
            error &&
            typeof error === 'object' &&
            [403, 404].includes(
              Number((error as { statusCode?: unknown }).statusCode),
            )
          )
            continue;
          throw error;
        }
        const head = await tx.relationHead(
          row.scope,
          row.assertion.sourceRelationId,
        );
        const assertion = {
          ...row.assertion,
          selectedHead: head?.assertionRef === row.assertion.assertionRef,
        };
        relations.push(assertion);
        releaseDependencies.push({ assertion, endpoints });
      }
      const receipt = this.receipt(
        ref,
        'WIKI_NATIVE_RELATIONS',
        root.grant,
        context,
      );
      await this.recheck(actor, root.grant, 'READ_RELATIONS', context);
      await tx.saveReceipt({
        scope: root.grant.scope,
        actorId: actor.canonicalSubject.id,
        receipt,
        context,
      });
      await this.recheck(actor, root.grant, 'READ_RELATIONS', context);
      return {
        grant: root.grant,
        rootDocumentVersionIds: root.stored.record.relatedDocumentVersionIds,
        releaseDependencies,
        response: {
          sourceRevisionRef: ref,
          relations,
          receipt,
          limitations: [...LIMITATIONS],
        },
      };
    });
    for (const id of result.rootDocumentVersionIds)
      await this.documents.assertRead(actor, id);
    const visibleRelations: TdmsRelationAssertion[] = [];
    // Recheck exact emitted dependencies after receipt/commit waits. These
    // independent authorities are not a coordinated atomic ACL snapshot.
    for (const { assertion, endpoints } of result.releaseDependencies) {
      try {
        for (const endpoint of endpoints) {
          if (endpoint.grant)
            await this.recheck(actor, endpoint.grant, 'READ_RECORD', context);
          for (const id of endpoint.documentVersionIds)
            await this.documents.assertRead(actor, id);
        }
      } catch (error) {
        if (isHiddenDocument(error)) continue;
        throw error;
      }
      visibleRelations.push(assertion);
    }
    await this.recheck(actor, result.grant, 'READ_RELATIONS', context);
    return { ...result.response, relations: visibleRelations };
  }
  async importPackage(
    actor: TdmsPublicActor,
    target: Omit<TdmsSourceScope, 'tenantId'>,
    value: unknown,
  ): Promise<TdmsImportReceipt> {
    assertPublicActor(actor);
    strict(object(target), ['sourceKey', 'sourceInstanceId', 'scopeId']);
    for (const v of Object.values(target)) identifier(v);
    const scope: TdmsSourceScope = { tenantId: actor.tenantId, ...target };
    const p = sourcePackage(value);
    return this.importPrepared(actor, scope, p, hash(p));
  }
  async importFileServicePackage(
    actor: TdmsPublicActor,
    value: unknown,
  ): Promise<TdmsImportReceipt> {
    assertPublicActor(actor);
    const envelope = fileServiceImport(value);
    const scope: TdmsSourceScope = {
      tenantId: actor.tenantId,
      sourceKey: envelope.sourceKey,
      sourceInstanceId: envelope.sourceInstanceId,
      scopeId: envelope.scopeId,
    };
    const p: PreparedSourcePackage = {
      ...structuredClone(envelope.package),
      artifacts: envelope.artifactSelections,
    };
    for (const record of p.records)
      record.artifactMemberIds = envelope.artifactSelections
        .filter((a) => a.ownerItemIds.includes(record.itemId))
        .map((a) => a.memberId);
    return this.importPrepared(actor, scope, p, hash(envelope));
  }
  private async importPrepared(
    actor: TdmsPublicActor,
    scope: TdmsSourceScope,
    p: PreparedSourcePackage,
    packageHash: string,
  ): Promise<TdmsImportReceipt> {
    assertOpinionCollectionIngress(p);
    const claims = importClaims(p);
    const grant = await this.authorization.authorizeImport(
      actor,
      scope,
      claims,
    );
    this.assertImportAdmission(actor, grant, scope, claims);
    // Release the native connection before FileService/Catalog I/O. Catalog owns its own transaction.
    const replay = await this.repository.transaction(async (tx) => {
      const saved = await tx.capture(scope, p.packageId);
      if (saved) {
        if (
          saved.dailyMetadata ||
          saved.packageHash !== packageHash ||
          saved.actorId !== actor.canonicalSubject.id
        )
          throw tdmsError('TDMS_PACKAGE_IDEMPOTENCY_CONFLICT', 409);
        return saved.receipt;
      }
      for (const r of p.records) {
        const head = await tx.recordHead(scope, r.recordKind, r.sourceRecordId);
        if ((head?.sourceRevisionRef ?? null) !== r.expectedHeadRevisionRef)
          throw tdmsError('TDMS_RECORD_HEAD_CAS_CONFLICT', 409);
        for (const id of r.relatedDocumentVersionIds)
          await this.documents.assertRead(actor, id);
      }
      for (const r of p.relations) {
        const head = await tx.relationHead(scope, r.sourceRelationId);
        if ((head?.assertionRef ?? null) !== r.expectedHeadAssertionRef)
          throw tdmsError('TDMS_RELATION_HEAD_CAS_CONFLICT', 409);
        for (const endpoint of [r.from, r.to])
          if (endpoint.kind !== 'PACKAGE_RECORD')
            await this.authorizeEndpoint(tx, actor, scope, endpoint, {});
      }
      return null;
    });
    await this.recheckImport(actor, grant, claims);
    if (replay) return { ...replay, created: false };
    const bindings: TdmsArtifactBinding[] = [];
    const verifiedAt = new Map<string, string>();
    for (const artifact of p.artifacts) {
      await this.recheckImport(actor, grant, claims);
      const input = { scope, actor, packageId: p.packageId, artifact };
      const binding =
        'selection' in artifact
          ? await (() => {
              if (!this.artifacts.acquireSelection)
                throw tdmsError('TDMS_ARTIFACT_SELECTION_UNCONFIGURED', 503);
              return this.artifacts.acquireSelection({ ...input, artifact });
            })()
          : await this.artifacts.acquire({ ...input, artifact });
      if (
        binding.memberId !== artifact.memberId ||
        binding.fileName !== artifact.fileName ||
        binding.mediaType !== artifact.mediaType ||
        binding.immutableReadbackVerified !== true ||
        binding.sha256 !== artifact.sha256 ||
        binding.byteLength !== artifact.byteLength ||
        binding.documentVersionId !== null
      )
        throw tdmsError('TDMS_CONTROLLED_ARTIFACT_BINDING_INVALID');
      bindings.push(binding);
      verifiedAt.set(artifact.memberId, new Date().toISOString());
      await this.recheckImport(actor, grant, claims);
    }
    // Rebuild from fresh heads; a late failure may retain only an unlinked candidate acquisition.
    const result = await this.repository.transaction(async (tx) => {
      const replay = await tx.capture(scope, p.packageId);
      if (replay) {
        if (
          replay.dailyMetadata ||
          replay.packageHash !== packageHash ||
          replay.actorId !== actor.canonicalSubject.id
        )
          throw tdmsError('TDMS_PACKAGE_IDEMPOTENCY_CONFLICT', 409);
        await this.recheckImport(actor, grant, claims);
        return { ...replay.receipt, created: false };
      }
      const now = new Date().toISOString(),
        captureRef = 'TDMS-CAP-' + randomUUID();
      const pending = new Map<string, TdmsStoredRevision>();
      const expected = new Map<string, string | null>();
      const observationGaps = new Set<string>();
      // All native CAS and exact-DM access preflights occur before candidate FileService writes.
      for (const r of p.records) {
        const head = await tx.recordHead(scope, r.recordKind, r.sourceRecordId);
        if ((head?.sourceRevisionRef ?? null) !== r.expectedHeadRevisionRef)
          throw tdmsError('TDMS_RECORD_HEAD_CAS_CONFLICT', 409);
        for (const id of r.relatedDocumentVersionIds)
          await this.documents.assertRead(actor, id);
        const previous = head
          ? await tx.revision(actor.tenantId, head.sourceRevisionRef)
          : null;
        const artifactIdentities = p.artifacts
          .filter((a) => r.artifactMemberIds.includes(a.memberId))
          .map((a) => ({
            sourceAttachmentId: a.sourceAttachmentId,
            sourceAttachmentVersion: a.sourceAttachmentVersion,
            memberId: a.memberId,
            sha256: a.sha256,
            byteLength: a.byteLength,
          }));
        const currentGaps: string[] = [];
        if (
          previous &&
          r.sourceVersion.confirmation === 'SOURCE_DECLARED' &&
          canonical(previous.record.sourceVersion) ===
            canonical(r.sourceVersion) &&
          hash(recordContent(previous.record)) !== hash(recordContent(r))
        )
          currentGaps.push('SAME_DECLARED_VERSION_CONTENT_CHANGED');
        // Only two already acquired byte identities of the SAME explicit attachment version
        // can conflict. NOT_READ -> acquired bytes, a new attachment or a changed declared
        // attachment version are distinct observations, not a manufactured formal revision.
        for (const next of artifactIdentities) {
          if (next.sourceAttachmentVersion === null) continue;
          const before = previous?.artifactIdentities?.find(
            (a) =>
              a.sourceAttachmentId === next.sourceAttachmentId &&
              a.sourceAttachmentVersion === next.sourceAttachmentVersion,
          );
          if (
            before &&
            (before.sha256 !== next.sha256 ||
              before.byteLength !== next.byteLength)
          )
            currentGaps.push('SAME_ATTACHMENT_VERSION_BYTES_CHANGED');
        }
        currentGaps.forEach((g) => observationGaps.add(g));
        const record: TdmsRecordRevision = {
          recordRef: head?.recordRef ?? 'TDMS-REC-' + randomUUID(),
          sourceRevisionRef: 'TDMS-REV-' + randomUUID(),
          captureRef,
          recordKind: r.recordKind,
          sourceRecordId: r.sourceRecordId,
          sourceKey: scope.sourceKey,
          sourceInstanceId: scope.sourceInstanceId,
          title: r.title,
          fileType: r.fileType,
          sourceVersion: r.sourceVersion,
          ...(r.businessVersion !== undefined
            ? { businessVersion: r.businessVersion }
            : {}),
          state: r.state,
          authors: r.authors,
          sourceModifiedAt: r.sourceModifiedAt,
          observedAt: r.observedAt,
          capturedAt: now,
          coverage: structuredClone(r.coverage),
          rawFields: r.rawFields,
          content: r.content,
          fieldProvenance: r.fieldProvenance,
          fieldSelectors: r.fieldProvenance.map((f) => ({
            fieldPath: f.fieldPath,
            selector: f.selector,
          })),
          artifacts: [],
          unreadAttachments: r.unreadAttachments ?? [],
          relatedDocumentVersionIds: r.relatedDocumentVersionIds,
          sourceVerification: 'DECLARED_ONLY',
          currentness: 'SELECTED_HOST_OBSERVATION',
          selectedHead:
            !head || Date.parse(r.observedAt) >= Date.parse(head.observedAt),
        };
        if (currentGaps.length)
          record.coverage = {
            ...record.coverage,
            status:
              record.coverage.status === 'UNKNOWN' ? 'UNKNOWN' : 'PARTIAL',
            gaps: [...new Set([...record.coverage.gaps, ...currentGaps])],
          };
        // Missing attachment bytes remain explicitly unread. They never become a binding/read receipt.
        if (
          unfulfilledUnread(r, p, verifiedAt).length &&
          record.coverage.status === 'COMPLETE'
        )
          record.coverage = {
            ...record.coverage,
            status: 'PARTIAL',
            gaps: [
              ...new Set([...record.coverage.gaps, 'ATTACHMENTS_NOT_READ']),
            ],
          };
        const attachmentAcquisitions = r.artifactMemberIds.map((memberId) => {
          const artifact = p.artifacts.find((a) => a.memberId === memberId)!;
          const current = exactUnread(r.unreadAttachments ?? [], artifact);
          const old = exactUnread(
            previous?.record.unreadAttachments ?? [],
            artifact,
          );
          const marker = current ?? old;
          const sourceObservedAtDeclared = current
            ? r.observedAt
            : old
              ? previous!.record.observedAt
              : r.observedAt;
          const hostBytesVerifiedAt = verifiedAt.get(memberId)!;
          if (
            current &&
            Date.parse(sourceObservedAtDeclared) >=
              Date.parse(hostBytesVerifiedAt)
          )
            throw tdmsError('TDMS_ATTACHMENT_OBSERVATION_TIME_UNDISTINGUISHED');
          return {
            memberId,
            sourceAttachmentId: artifact.sourceAttachmentId,
            sourceAttachmentVersion: artifact.sourceAttachmentVersion,
            acquisitionId: bindings.find((b) => b.memberId === memberId)!
              .acquisitionId,
            sourceObservedAtDeclared,
            sourceReadStatusAtObservation: marker?.readStatus ?? null,
            sourceObservationRevisionRef:
              !current && old ? previous!.record.sourceRevisionRef : null,
            hostBytesVerifiedAt,
          };
        });
        pending.set(r.itemId, {
          scope,
          record,
          artifactIdentities,
          attachmentAcquisitions,
        });
        expected.set(r.itemId, r.expectedHeadRevisionRef);
      }
      for (const r of p.relations) {
        const h = await tx.relationHead(scope, r.sourceRelationId);
        if ((h?.assertionRef ?? null) !== r.expectedHeadAssertionRef)
          throw tdmsError('TDMS_RELATION_HEAD_CAS_CONFLICT', 409);
        for (const e of [r.from, r.to])
          if (e.kind !== 'PACKAGE_RECORD')
            await this.authorizeEndpoint(tx, actor, scope, e, {});
      }
      await this.recheckImport(actor, grant, claims);
      const recordRevisionRefs = [];
      for (const r of p.records) {
        const stored = pending.get(r.itemId)!;
        stored.record.artifacts = r.artifactMemberIds.map(
          (id) => bindings.find((b) => b.memberId === id)!,
        );
        await tx.saveRevision(
          {
            scope,
            recordRef: stored.record.recordRef,
            sourceRecordId: r.sourceRecordId,
            recordKind: r.recordKind,
            sourceRevisionRef: stored.record.sourceRevisionRef,
            observedAt: r.observedAt,
          },
          expected.get(r.itemId)!,
          stored,
        );
        recordRevisionRefs.push(stored.record.sourceRevisionRef);
      }
      const assertionRefs = [];
      for (const relation of p.relations) {
        const head = await tx.relationHead(scope, relation.sourceRelationId);
        const {
          expectedHeadAssertionRef: ignored,
          from,
          to,
          ...data
        } = relation;
        void ignored;
        const verificationGaps = relationVerificationGaps(relation);
        if (
          relation.changeClass !== 'UNSPECIFIED' ||
          relation.completionEffect !== 'UNSPECIFIED'
        ) {
          for (const endpoint of [relation.from, relation.to]) {
            const revision =
              endpoint.kind === 'PACKAGE_RECORD'
                ? pending.get(endpoint.itemId)
                : endpoint.kind === 'NATIVE_RECORD_REVISION'
                  ? await tx.revision(
                      actor.tenantId,
                      endpoint.sourceRevisionRef,
                    )
                  : null;
            if (
              revision &&
              revision.record.sourceVersion.confirmation ===
                'VERSION_UNCONFIRMED'
            )
              verificationGaps.push(
                'REVISION_RULE_ENDPOINT_SOURCE_VERSION_UNCONFIRMED',
              );
          }
        }
        verificationGaps.forEach((g) => observationGaps.add(g));
        const assertion: TdmsRelationAssertion = {
          ...data,
          coverage: verificationGaps.length
            ? {
                ...data.coverage,
                status:
                  data.coverage.status === 'UNKNOWN' ? 'UNKNOWN' : 'PARTIAL',
                gaps: [
                  ...new Set([...data.coverage.gaps, ...verificationGaps]),
                ],
              }
            : data.coverage,
          from: resolveEndpoint(from, pending),
          to: resolveEndpoint(to, pending),
          relationRef: head?.relationRef ?? 'TDMS-REL-' + randomUUID(),
          assertionRef: 'TDMS-AST-' + randomUUID(),
          captureRef,
          sourceVerification: 'DECLARED_ONLY',
          selectedHead:
            !head ||
            Date.parse(relation.observedAt) >= Date.parse(head.observedAt),
        };
        await tx.saveAssertion(
          {
            scope,
            relationRef: assertion.relationRef,
            sourceRelationId: relation.sourceRelationId,
            assertionRef: assertion.assertionRef,
            observedAt: relation.observedAt,
          },
          relation.expectedHeadAssertionRef,
          { scope, assertion },
        );
        assertionRefs.push(assertion.assertionRef);
      }
      const gaps = [
        ...new Set([
          ...packageGaps({
            ...p,
            records: p.records.map((r) => ({
              ...r,
              unreadAttachments: unfulfilledUnread(r, p, verifiedAt),
            })),
          }),
          ...observationGaps,
        ]),
      ];
      if (bindings.some((b) => b.registrationGap))
        gaps.push(
          'FORMAL_REGISTRATION_REQUIRES_INDEPENDENT_RETENTION_AUTHORITY',
        );
      const status =
        p.coverage.status === 'UNKNOWN'
          ? 'UNKNOWN'
          : p.coverage.status === 'PARTIAL' || gaps.length
            ? 'PARTIAL'
            : 'COMPLETE';
      const receipt: TdmsImportReceipt = {
        captureRef,
        packageId: p.packageId,
        status,
        created: true,
        sourceVerification: 'DECLARED_ONLY',
        recordRevisionRefs,
        assertionRefs,
        artifactBindings: bindings,
        gaps: [...new Set(gaps)].sort(),
        engineeringAdoption: 'NOT_CREATED',
        executionVerified: false,
      };
      await this.recheckImport(actor, grant, claims);
      await tx.saveCapture({
        scope,
        packageId: p.packageId,
        packageHash,
        actorId: actor.canonicalSubject.id,
        receipt,
        query: p.query,
        capturedAt: now,
        permissionRevision: grant.permissionRevision,
        admissionAuthorityRef: grant.authorityRef,
      });
      await this.recheckImport(actor, grant, claims);
      return receipt;
    });
    await this.recheckImport(actor, grant, claims);
    return result;
  }
  private assertImportAdmission(
    actor: TdmsPublicActor,
    admission: TdmsImportAdmission,
    scope: TdmsSourceScope,
    claims: TdmsImportMemberClaims,
  ) {
    this.assertGrant(actor, admission, scope);
    if (
      !admission.authorityRef ||
      admission.captureRetentionAllowed !== true ||
      admission.nativeProjectionAllowed !== true
    )
      throw tdmsError('TDMS_IMPORT_RIGHTS_ADMISSION_REQUIRED', 403);
    const allowed = admission.permittedMembers;
    if (
      !allowed ||
      !Array.isArray(allowed.records) ||
      !Array.isArray(allowed.artifacts) ||
      !Array.isArray(allowed.relationIds)
    )
      throw tdmsError('TDMS_IMPORT_MEMBER_SCOPE_ADMISSION_REQUIRED', 403);
    const recordAllowed = (r: { recordKind: string; sourceRecordId: string }) =>
      allowed?.records.some(
        (a) =>
          a.recordKind === r.recordKind &&
          a.sourceRecordId === r.sourceRecordId,
      );
    if (
      !allowed ||
      claims.records.some((r) => !recordAllowed(r)) ||
      claims.relationIds.some((id) => !allowed.relationIds.includes(id)) ||
      claims.artifacts.some(
        (a) =>
          !a.owners.length ||
          !allowed.artifacts.some(
            (b) =>
              b.memberId === a.memberId &&
              b.sourceAttachmentId === a.sourceAttachmentId &&
              b.sourceAttachmentVersion === a.sourceAttachmentVersion &&
              b.metadataOnly === a.metadataOnly &&
              a.owners.every((owner) =>
                b.owners.some(
                  (bound) =>
                    bound.recordKind === owner.recordKind &&
                    bound.sourceRecordId === owner.sourceRecordId,
                ),
              ),
          ),
      )
    )
      throw tdmsError('TDMS_IMPORT_MEMBER_SCOPE_ADMISSION_REQUIRED', 403);
  }
  private async recheckImport(
    actor: TdmsPublicActor,
    expected: TdmsImportAdmission,
    claims: TdmsImportMemberClaims,
  ) {
    const fresh = await this.authorization.authorizeImport(
      actor,
      expected.scope,
      claims,
    );
    this.assertImportAdmission(actor, fresh, expected.scope, claims);
    if (
      fresh.permissionRevision !== expected.permissionRevision ||
      fresh.authorityRef !== expected.authorityRef
    )
      throw tdmsError('TDMS_SOURCE_PERMISSION_CHANGED', 409);
  }
  private async authorizedRevision(
    tx: TdmsTransaction,
    actor: TdmsPublicActor,
    ref: string,
    action: 'READ_RECORD' | 'READ_RELATIONS' | 'READ_HISTORY',
    context: TdmsReadContext,
  ) {
    const stored = await tx.revision(actor.tenantId, ref);
    if (!stored) throw tdmsError('TDMS_SOURCE_NOT_FOUND', 404);
    const grant = await this.authorization.authorize(
      actor,
      stored.scope,
      action,
      context,
    );
    this.assertGrant(actor, grant, stored.scope);
    const head = await tx.recordHead(
      stored.scope,
      stored.record.recordKind,
      stored.record.sourceRecordId,
    );
    stored.record = {
      ...stored.record,
      selectedHead: head?.sourceRevisionRef === ref,
    };
    return { stored, grant };
  }
  private async authorizeEndpoint(
    tx: TdmsTransaction,
    actor: TdmsPublicActor,
    scope: TdmsSourceScope,
    e: TdmsExactEndpoint,
    context: TdmsReadContext,
  ): Promise<TdmsEndpointReadDependency> {
    if (e.kind === 'DOCUMENT_VERSION') {
      await this.documents.assertRead(actor, e.documentVersionId);
      return { documentVersionIds: [e.documentVersionId] };
    }
    if (e.kind === 'UNRESOLVED') return { documentVersionIds: [] };
    const row = await this.authorizedRevision(
      tx,
      actor,
      e.sourceRevisionRef,
      'READ_RECORD',
      context,
    );
    if (!sameScope(scope, row.stored.scope))
      throw tdmsError('TDMS_ENDPOINT_SCOPE_MISMATCH', 404);
    await this.recheck(actor, row.grant, 'READ_RECORD', context);
    return {
      grant: row.grant,
      documentVersionIds: row.stored.record.relatedDocumentVersionIds,
    };
  }
  private async assertRelatedDocuments(
    actor: TdmsPublicActor,
    r: TdmsRecordRevision,
  ) {
    for (const id of r.relatedDocumentVersionIds)
      await this.documents.assertRead(actor, id);
  }
  private assertGrant(
    actor: TdmsPublicActor,
    grant: TdmsSourceGrant,
    scope?: TdmsSourceScope,
  ) {
    if (
      !grant?.permissionRevision ||
      grant.scope.tenantId !== actor.tenantId ||
      (scope && !sameScope(grant.scope, scope))
    )
      throw tdmsError('TDMS_SOURCE_AUTHORIZATION_INVALID', 403);
  }
  private async recheck(
    actor: TdmsPublicActor,
    grant: TdmsSourceGrant,
    action:
      | 'IMPORT'
      | 'CATALOGUE'
      | 'READ_RECORD'
      | 'READ_RELATIONS'
      | 'READ_HISTORY',
    context: TdmsReadContext,
  ) {
    const fresh = await this.authorization.authorize(
      actor,
      grant.scope,
      action,
      context,
    );
    this.assertGrant(actor, fresh, grant.scope);
    if (fresh.permissionRevision !== grant.permissionRevision)
      throw tdmsError('TDMS_SOURCE_PERMISSION_CHANGED', 409);
  }
  private receipt(
    ref: string,
    purpose: TdmsReadReceipt['purpose'],
    grant: TdmsSourceGrant,
    context: TdmsReadContext,
  ): TdmsReadReceipt {
    return {
      receiptRef: 'TDMS-READ-' + randomUUID(),
      sourceRevisionRef: ref,
      readAt: new Date().toISOString(),
      purpose,
      fieldPaths: null,
      taskContextRef:
        context.matterId ??
        context.documentVersionId ??
        context.workItemId ??
        context.jobAidAttemptRef ??
        null,
      readPerformed: true,
      permissionRevision: grant.permissionRevision,
      engineeringAdoption: 'NOT_CREATED',
      executionVerified: false,
    };
  }
}
function resolveEndpoint(
  e: TdmsPackageEndpoint,
  rows: Map<string, TdmsStoredRevision>,
): TdmsExactEndpoint {
  return e.kind === 'PACKAGE_RECORD'
    ? {
        kind: 'NATIVE_RECORD_REVISION',
        sourceRevisionRef: rows.get(e.itemId)!.record.sourceRevisionRef,
      }
    : e;
}
function recordContent(
  r: Pick<
    TdmsRecordRevision,
    'title' | 'fileType' | 'state' | 'authors' | 'rawFields' | 'content'
  >,
) {
  return {
    title: r.title,
    fileType: r.fileType,
    state: r.state,
    authors: r.authors,
    rawFields: r.rawFields,
    content: r.content,
  };
}
function summary(r: TdmsRecordRevision): TdmsRecordSummary {
  const {
    captureRef,
    sourceModifiedAt,
    rawFields,
    content,
    fieldProvenance,
    artifacts,
    unreadAttachments,
    selectedHead,
    ...s
  } = r;
  void [
    captureRef,
    sourceModifiedAt,
    rawFields,
    content,
    fieldProvenance,
    artifacts,
    unreadAttachments,
    selectedHead,
  ];
  return s;
}

function isHiddenDocument(error: unknown): boolean {
  return (
    !!error &&
    typeof error === 'object' &&
    [403, 404].includes(Number((error as { statusCode?: unknown }).statusCode))
  );
}

function importClaims(p: PreparedSourcePackage): TdmsImportMemberClaims {
  return {
    records: p.records.map((r) => ({
      recordKind: r.recordKind,
      sourceRecordId: r.sourceRecordId,
    })),
    artifacts: [
      ...p.artifacts.map((a) => ({
        memberId: a.memberId,
        sourceAttachmentId: a.sourceAttachmentId,
        sourceAttachmentVersion: a.sourceAttachmentVersion,
        owners: p.records
          .filter((r) => r.artifactMemberIds.includes(a.memberId))
          .map((r) => ({
            recordKind: r.recordKind,
            sourceRecordId: r.sourceRecordId,
          })),
      })),
      ...p.records.flatMap((r) =>
        (r.unreadAttachments ?? []).map((a, i) => ({
          memberId: `METADATA_ONLY:${r.itemId}:${i}`,
          sourceAttachmentId: a.sourceAttachmentId,
          sourceAttachmentVersion: a.sourceAttachmentVersion,
          metadataOnly: true as const,
          owners: [
            { recordKind: r.recordKind, sourceRecordId: r.sourceRecordId },
          ],
        })),
      ),
    ],
    relationIds: p.relations.map((r) => r.sourceRelationId),
    relatedDocumentVersionIds: p.records.flatMap(
      (r) => r.relatedDocumentVersionIds,
    ),
  };
}

function exactUnread(
  unread: TdmsRecordRevision['unreadAttachments'],
  artifact: {
    sourceAttachmentId: string;
    sourceAttachmentVersion: string | null;
  },
) {
  if (artifact.sourceAttachmentVersion === null) return undefined;
  return unread.find(
    (a) =>
      a.sourceAttachmentId === artifact.sourceAttachmentId &&
      a.sourceAttachmentVersion === artifact.sourceAttachmentVersion,
  );
}
function unfulfilledUnread(
  record: TdmsSourcePackage['records'][number],
  packet: PreparedSourcePackage,
  verifiedAt: Map<string, string>,
) {
  return (record.unreadAttachments ?? []).filter(
    (marker) =>
      !packet.artifacts.some(
        (artifact) =>
          record.artifactMemberIds.includes(artifact.memberId) &&
          artifact.sourceAttachmentVersion !== null &&
          marker.sourceAttachmentId === artifact.sourceAttachmentId &&
          marker.sourceAttachmentVersion === artifact.sourceAttachmentVersion &&
          verifiedAt.has(artifact.memberId),
      ),
  );
}
