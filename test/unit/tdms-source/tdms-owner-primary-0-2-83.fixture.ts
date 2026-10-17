import { TdmsSourceService } from '../../../server/modules/tdms-source/tdms-source.service';
import { TdmsReceiverService } from '../../../server/modules/tdms-source/tdms-receiver.service';
import { MiaodaTdmsSourceAuthorization } from '../../../server/modules/tdms-source/miaoda-tdms-source-authorization';
import { MiaodaTdmsDailyArtifactStore } from '../../../server/modules/tdms-source/miaoda-tdms-daily-artifact-store';
import type { TdmsReceiverRepository } from '../../../server/modules/tdms-source/tdms-receiver.repository';
import type { SessionResolver } from '../../../server/modules/identity/session-resolver.service';
import { adaptTdmsDailySource } from '../../../server/modules/tdms-source/tdms-daily-source-adapter';
import { syntheticReceiverFixture } from './tdms-real-receiver.fixture';
import { MemoryTdmsRepository } from './tdms-memory-double';
import { actor } from './tdms-fixtures';
import type { TdmsStoredSelection } from '../../../server/modules/tdms-source/tdms-receiver.types';

import { hash } from '../../../server/modules/tdms-source/tdms-source.validation';
import {
  currentDerivedOriginal,
  proofOfCurrent,
} from './tdms-current-contract.fixture';
import {
  copyComplete,
  syntheticCompleteEnvelope,
} from './tdms-complete-owned.fixture';
import { completeOwnedRecord } from '../../../server/modules/tdms-source/tdms-complete-owned-source.validation';
import {
  syntheticSbDetails,
  sbDetail,
  sealSb,
} from './tdms-reviewed-sb-0-2-73.fixture';
import { REVIEWED_SB_NATIVE_LAYOUT_MODEL } from '../../../server/modules/tdms-source/tdms-reviewed-sb-native-layout';

export type PrimaryStageScope = 'SB' | 'SL' | 'MT' | 'AD' | 'SIL' | 'SB-IN';

// Synthetic partial wire evidence. No Source collector or real original runs.
// Legal captures use the existing Host snapshot helper. The retained baseline
// red used the literal sealer; malformed API probes retain the original snapshot.
export function syntheticOwnerPrimaryStage(
  scope: PrimaryStageScope = 'SL',
  state = 'Estimating',
  format = 'PDF',
) {
  const original = currentDerivedOriginal(format);
  const env =
      scope === 'AD'
        ? syntheticCompleteEnvelope('AD')
        : syntheticSbDetails(state),
    record = env.package.records[0];
  const proof = proofOfCurrent(env);
  proof.scopeId = scope;
  proof.requestedCriteria.scopeId = scope;
  proof.requestedCriteria.collectionStage = 'OWNER_PRIMARY';
  for (const read of proof.reads) {
    read.owner.stateRaw = state;
    if (scope !== 'AD') read.owner.scopeEvidence.businessType = scope;
    if (scope === 'AD') {
      read.owner.businessVersion = null;
      read.owner.businessVersionEvidence = {
        ...read.owner.businessVersionEvidence,
        state: 'NOT_READ',
        actualLabel: 'Business Version:',
        rawValue: null,
        observedTotalCodepoints: 0,
        locator: sbDetail.panelLocator + ' [unreviewed-business-version-model]',
      };
      read.fields = read.fields.filter((f: any) => f.tabId === sbDetail.tabId);
      read.sections = read.sections.filter(
        (s: any) => s.tabId === sbDetail.tabId,
      );
      read.rosterEvidence.structuralRosters =
        read.rosterEvidence.structuralRosters.filter(
          (s: any) => s.tabId === sbDetail.tabId,
        );
    }
    for (const field of read.fields) {
      if (field.strictBlankEvidence) field.strictBlankEvidence.scopeId = scope;
    }
    read.tabs = (
      scope === 'AD'
        ? [
            sbDetail,
            {
              tabId: 'infoPageinfoPanelID__infoPage_myTab_object_adRelatedTab',
              label: 'AD Relate Tab',
              panelLocator: '#infoPage_myTab_object_adRelatedTab',
            },
          ]
        : REVIEWED_SB_NATIVE_LAYOUT_MODEL.panels
    ).map((panel: typeof sbDetail) => ({
      tabId: panel.tabId,
      label: panel.label,
      panelLocator: panel.panelLocator,
      state: panel.tabId === sbDetail.tabId ? 'VALUE' : 'NOT_READ',
      required: true,
      sourceDeclared: true,
      reasonCode:
        panel.tabId === sbDetail.tabId
          ? null
          : 'TDMS_COMPLETE_OWNER_PRIMARY_STAGE_DEFERRED',
    }));
    read.rosterEvidence.tabIds = read.tabs.map(
      (tab: typeof sbDetail) => tab.tabId,
    );
    read.rosterEvidence.layoutEvidencePending = true;
    read.rosterEvidence.unknownRequiredSurfaces = read.tabs
      .filter((tab: typeof sbDetail) => tab.tabId !== sbDetail.tabId)
      .map((tab: typeof sbDetail) => tab.panelLocator);
    const attachment = copyComplete(
      proofOfCurrent(original.env).reads[1].attachments[0],
    );
    attachment.ownerSourceRecordId = record.sourceRecordId;
    attachment.sourceVersion = copyComplete(record.sourceVersion);
    attachment.primaryMetadata.ownerTechnicalVersion = copyComplete(
      record.sourceVersion,
    );
    attachment.primaryMetadata.ownerBusinessVersion = copyComplete(
      read.owner.businessVersion,
    );
    read.attachments = [attachment];
  }
  record.content.completeOwnedFields = copyComplete(proof.reads[1].fields);
  record.coverage.gaps = [
    'REQUIRED_TARGET_OWN_SOURCES_PENDING',
    'COMPLETION_CERTIFICATE_NOT_ISSUED',
    'OWN_LAYOUT_REPRESENTATIVE_PENDING',
    'OWN_CONTENT_UNREAD',
  ];
  env.package.coverage = copyComplete(record.coverage);
  env.package.query.originalAcquisition = copyComplete(
    original.env.package.query.originalAcquisition,
  );
  if (scope === 'AD') {
    Object.assign(
      record,
      completeOwnedRecord(
        {
          schemaVersion: proof.schemaVersion,
          requestedCriteria: proof.requestedCriteria,
          documentIdentity: proof.documentIdentity,
          nativeReloadProvenance: proof.nativeReloadProvenance,
          reads: proof.reads,
        },
        proof.requestedCriteria,
      ),
    );
    env.package.coverage = copyComplete(record.coverage);
  }
  sealSb(env);
  const binding = {
    ...copyComplete(original.env.package.artifactBindings[0]),
    ownerSnapshotId: record.snapshotId,
  };
  const { bindingId: _binding, observedAt: _observed, ...identity } = binding;
  void _binding;
  void _observed;
  binding.bindingId = 'TDMSBIND-' + hash(identity);
  env.package.artifactBindings = [binding];
  env.package.observedAt = original.env.package.observedAt;
  env.requestId = 'TDMSIMPORT-' + hash(env.package);
  return {
    env,
    bytes: original.bytes,
    binding,
    selection: {
      ...original.selection,
      memberId: binding.bindingId,
      ownerItemIds: [record.snapshotId],
    },
  };
}

// Actual receiver/authorization/artifact/Source services; only external identity,
// FileService, catalog and repository persistence are explicit local memory ports.
// This is not SQL, RLS, Hosted identity or production CAS evidence.

export function ownerPrimaryServices() {
  const original = syntheticOwnerPrimaryStage(),
    f = syntheticReceiverFixture();
  const prepared = adaptTdmsDailySource(original.env);
  for (const action of Object.values(f.actions))
    action.permittedMembers = copyComplete(prepared.memberClaims);
  const selection = {
    ...f.selection,
    filePath:
      'tdms-source/uploads/' +
      original.env.requestId +
      '_' +
      original.binding.bindingId,
  };
  f.objects.clear();
  f.objects.set(selection.filePath, {
    bytes: original.bytes,
    metadata: {
      bucketID: selection.bucketId,
      filePath: selection.filePath,
      id: selection.expectedProviderObjectId,
      name: original.binding.filename,
      createdBy: { userID: actor().canonicalSubject.id },
      metadata: {
        mimeType: original.binding.mediaType,
        contentLength: original.bytes.length,
      },
    },
  });
  let stored: TdmsStoredSelection | null = null;
  const port = {
    transaction: async <T>(fn: (db: unknown) => Promise<T>) => fn({}),
    authorities: async () => [copyComplete(f.row)],
    selection: async () => stored && copyComplete(stored),
    insertSelection: async (
      _actor: unknown,
      _authority: unknown,
      value: TdmsStoredSelection,
    ) => {
      stored ??= copyComplete(value);
      return copyComplete(stored);
    },
  } as unknown as TdmsReceiverRepository;
  const authorization = new MiaodaTdmsSourceAuthorization(port);
  const artifacts = new MiaodaTdmsDailyArtifactStore(
    f.files as any,
    f.catalog as any,
    authorization,
    port,
  );
  const session = {
    actor: actor(),
    session: {
      id: 'synthetic-opaque-session',
      revision: 1,
      expiresAt: new Date(Date.now() + 60000),
    },
  };
  const identity = { valid: true };
  const sessions = {
    withNativeBrowserIdentity: async (
      _request: unknown,
      fn: (value: unknown) => Promise<unknown>,
    ) => fn({ actor: actor(), oauthSession: identity.valid ? session : null }),
    withVerifiedNativeBrowserSql: async (fn: () => Promise<unknown>) => fn(),
    withVerifiedNativeBrowserServiceSql: async (fn: () => Promise<unknown>) =>
      fn(),
    resolve: async () => (identity.valid ? session : null),
  } as unknown as SessionResolver;
  const receiver = new TdmsReceiverService(
    port,
    authorization,
    artifacts,
    sessions,
  );
  const repository = new MemoryTdmsRepository();
  const documents = { assertRead: jest.fn() };
  const service = new TdmsSourceService(
    repository,
    authorization,
    artifacts,
    documents,
  );
  return {
    ...original,
    selection,
    f,
    identity,
    receiver,
    service,
    repository,
    documents,
    request: { headers: {} } as any,
  };
}
