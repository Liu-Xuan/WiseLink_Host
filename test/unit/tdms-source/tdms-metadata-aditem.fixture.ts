import golden from '../../fixtures/tdms-source/metadata-aditem-producer-qualified.synthetic.json';
import { hash } from '../../../server/modules/tdms-source/tdms-source.validation';
import {
  completeOwnedTargetOccurrences,
  completeOwnedObservedEdges,
} from '../../../server/modules/tdms-source/tdms-complete-owned-source.validation';
import {
  copyComplete,
  syntheticCompleteEnvelope,
  withCompleteRelation,
  sealComplete,
} from './tdms-complete-owned.fixture';
import {
  proofOfCurrent,
  currentClassification,
  resealClassification,
} from './tdms-current-contract.fixture';
import {
  efRequestStructuralRosters,
  resealEfRequest,
} from './tdms-efrequest-contract.fixture';
import {
  syntheticFiniteEfRequest,
  finiteModelsGolden,
} from './tdms-finite-required-models.fixture';

// All values are fabricated. Model literals and producer qualification hashes
// come from the independently supplied pure Source code, never a live capture.
export const metadataAdItemGolden = golden;
const unknown = () => ({
  rawRevision: null,
  rawIteration: null,
  confirmation: 'VERSION_UNCONFIRMED',
});
const value = (
  label: string,
  raw: string | null,
  locator: string,
  state = raw === null ? 'NOT_READ' : 'VALUE',
) => ({
  state,
  actualLabel: label,
  rawValue: raw,
  locator,
  observedTotalCodepoints: raw === null ? 0 : [...raw].length,
});
export function resealMetadata(env: any) {
  const record = env.package.records[0],
    proof = proofOfCurrent(env),
    read = proof.reads[1];
  proof.targetOccurrences = completeOwnedTargetOccurrences(proof);
  record.sourceVersion = copyComplete(read.owner.sourceVersion);
  record.businessVersion = copyComplete(read.owner.businessVersion);
  record.state = { rawCode: null, rawName: read.owner.stateRaw };
  record.rawFields.storageType.rawName = read.owner.rawHeaderType;
  record.content.completeOwnedFields = copyComplete(read.fields);
  const gaps = [
    'REQUIRED_TARGET_OWN_SOURCES_PENDING',
    'COMPLETION_CERTIFICATE_NOT_ISSUED',
  ];
  if (read.sourceContext.principalDisplayName === null)
    gaps.push('SOURCE_PRINCIPAL_UNOBSERVED');
  if (read.owner.nativeTypeId === null) gaps.push('NATIVE_TYPE_UNOBSERVED');
  if (read.owner.sourceVersion.confirmation !== 'SOURCE_DECLARED')
    gaps.push('TECHNICAL_VERSION_UNCONFIRMED');
  if (read.relationTables.some((t: any) => t.enumerationState !== 'VALUE'))
    gaps.push('RELATION_ENUMERATION_UNVERIFIED');
  if (read.rosterEvidence.layoutEvidencePending)
    gaps.push('OWN_LAYOUT_REPRESENTATIVE_PENDING');
  if (
    read.rosterEvidence.unknownRequiredSurfaces.length ||
    read.rosterEvidence.unreadControls.length ||
    read.tabs.some(
      (t: any) =>
        t.required &&
        ['NOT_READ', 'NOT_LOADED', 'TRUNCATED', 'ACCESS_DENIED'].includes(
          t.state,
        ),
    ) ||
    read.fields.some((f: any) =>
      ['NOT_READ', 'NOT_LOADED', 'TRUNCATED', 'ACCESS_DENIED'].includes(
        f.value.state,
      ),
    )
  )
    gaps.push('OWN_CONTENT_UNREAD');
  record.coverage = { status: 'PARTIAL', gaps, readback: 'NON_ATOMIC' };
  env.package.coverage = copyComplete(record.coverage);
  sealComplete(env);
  env.package.edges = completeOwnedObservedEdges(record);
  env.requestId = 'TDMSIMPORT-' + hash(env.package);
  return env;
}
export function syntheticAdItem() {
  const env = syntheticCompleteEnvelope('AD_ITEM'),
    proof = proofOfCurrent(env),
    m = golden.adItemModel;
  const template = proofOfCurrent(withCompleteRelation()).reads[1]
    .relationTables[0];
  proof.requestedCriteria.expectedOwner.sourceVersion = unknown();
  for (const read of proof.reads) {
    const owner = read.owner;
    owner.rawHeaderIdentifier = owner.number;
    owner.rawHeaderType = m.nativeHeaderType;
    owner.sourceVersion = unknown();
    owner.technicalVersionEvidence = value(
      'Version:',
      null,
      m.detailPanel + ' [expected-label=Version:]',
      'ABSENT',
    );
    owner.technicalVersionFieldEvidence = copyComplete(
      owner.technicalVersionEvidence,
    );
    owner.businessVersion = null;
    owner.businessVersionEvidence = value(
      'Business Version:',
      null,
      m.detailPanel + ' [unreviewed-business-version-model]',
    );
    owner.stateRaw = 'In Work';
    owner.sourceCreatedRaw = '2026-10-11 08:00';
    read.tabs = m.tabs.map((t: any) => ({
      ...copyComplete(t),
      state: t.tabId === m.detailTabId ? 'VALUE' : 'NOT_READ',
      required: true,
      sourceDeclared: true,
      reasonCode: null,
    }));
    read.sections = m.sections.map((s: any) => ({
      sectionId: m.detailTabId + '::' + s.sectionId,
      tabId: m.detailTabId,
      label: s.sectionLabel,
      panelLocator: m.detailPanel + ' #' + s.sectionId,
      state: 'VALUE',
      sourceDeclared: true,
    }));
    read.fields = m.sections.flatMap((section: any) =>
      section.fieldLabels.map((label: string, index: number) => {
        const locator =
          m.detailPanel +
          ' #' +
          section.dataStoreId +
          ' > tbody > tr:nth-child(' +
          (index + 1) +
          ') > td.attributePanel-value';
        const raw =
          label === 'Last Modified:'
            ? owner.sourceModifiedRaw
            : label === 'Created On:'
              ? owner.sourceCreatedRaw
              : label === '评估意见:'
                ? null
                : 'Synthetic ' + label;
        return {
          fieldId: locator,
          tabId: m.detailTabId,
          sectionId: m.detailTabId + '::' + section.sectionId,
          labelOrigin: 'NATIVE_SOURCE_DECLARED',
          nativeControl: { tag: 'TD', readOnly: null, disabled: null },
          value: value(
            label,
            raw,
            locator,
            label === '评估意见:' ? 'NOT_APPLICABLE' : 'VALUE',
          ),
          links: ['Created By:', 'Modified By:'].includes(label)
            ? [
                {
                  targetRef: 'OR:wt.org.WTUser:1234',
                  rawHref: '/infoPage?oid=OR:wt.org.WTUser:1234',
                  numberRaw: 'SYNTHETIC-USER',
                  nativeRole: 'RELATED',
                  locator: locator + ' a',
                },
              ]
            : [],
        };
      }),
    );
    read.attachments = [];
    read.relationTables = m.nativeGridSurfaces.map(
      (spec: any, index: number) => {
        const t = copyComplete(template),
          id = 'synthetic-aditem-grid-' + index,
          row = t.rows[0];
        Object.assign(t, {
          tableId: id,
          tabId: spec.tabId,
          tableTitle: spec.gridId,
          panelLocator: spec.panelLocator,
          gridId: spec.gridId,
          relationshipRole: 'UNKNOWN',
          direction: 'UNKNOWN',
          rawHeaders: spec.columns.map((c: any) => c.actualLabel),
          ownerSourceRecordId: owner.sourceRecordId,
          ownerSourceVersion: copyComplete(owner.sourceVersion),
          observedAt: read.observedAt,
        });
        row.occurrenceId = id + ':0';
        row.cells = spec.columns.map((c: any) => {
          const unread = c.valuePolicy.startsWith('NOT_READ');
          return {
            state: unread ? 'NOT_READ' : 'VALUE',
            actualLabel: c.actualLabel,
            rawValue: unread ? null : 'Synthetic',
            observedTotalCodepoints: unread ? 0 : 9,
          };
        });
        row.sourceLinks = [];
        row.observedVersion = unknown();
        t.windows[0].rowOccurrenceIds = [row.occurrenceId];
        t.windows[0].observedAt = read.observedAt;
        if (spec.gridId === 'mytreetable') {
          t.scanMode = 'TREE';
          t.enumerationState = 'NOT_READ';
          t.stopReason = 'AD_ITEM_TREE_END_MODEL_UNREVIEWED';
          t.terminal.kind = 'UNCONFIRMED';
          t.terminal.nativeTerminal = false;
          t.terminal.allTreeNodesExpanded = false;
          row.sourceLinks = [
            {
              targetRef: 'OR:wt.org.WTUser:4321',
              rawHref: '/infoPage?oid=OR:wt.org.WTUser:4321',
              numberRaw: 'SYNTHETIC-CREATOR',
              nativeRole: 'UNREVIEWED_NATIVE_COLUMN',
              nativeColumnLabel: 'Created By',
              nativeColumnToken: 'creator',
              locator: spec.panelLocator + ' #mytreetable synthetic-row a',
            },
          ];
        }
        return t;
      },
    );
    read.rosterEvidence = {
      tabRosterSource: 'OWN_INFOPAGE_TAB_STRIP',
      tabIds: read.tabs.map((t: any) => t.tabId),
      structuralRosters: [],
      unreadControls: [],
      unknownRequiredSurfaces: [],
      layoutEvidencePending: true,
      nativeTabStripIds: [
        ...read.tabs.map((t: any) => t.tabId),
        m.nonContentControl.actionId,
      ],
      nonContentControls: [
        {
          actionId: m.nonContentControl.actionId,
          tag: 'LI',
          rawClassName: 'x-tab-with-icon',
          rawCaption: '',
          locator: '#' + m.nonContentControl.actionId,
          rootLocator: m.rootLocator,
          semantic: m.nonContentControl.semantic,
          modelRevision: m.modelRevision,
        },
      ],
    };
    efRequestStructuralRosters(read);
  }
  return resealMetadata(env);
}
export function syntheticCurrentEngineering(
  subtype = 'EF',
  revision = 'tdms-engineering-own-subtype@2',
) {
  const env = currentClassification('engineering'),
    record = env.package.records[0],
    p: any = record.rawFields.engineeringClassification;
  p.classificationRevision = revision;
  p.requestedCriteria.classificationRevision = revision;
  for (const read of p.reads) {
    read.owner.scopeEvidence.engineeringSubtype = subtype;
    read.nativeSubtype.rawValue = subtype;
    read.nativeSubtype.observedTotalCodepoints = [...subtype].length;
  }
  p.resolvedSubtype = (revision === 'tdms-engineering-own-subtype@1'
    ? ['EO', 'EF', 'AEO']
    : ['EO', 'AEO']
  ).includes(subtype)
    ? subtype
    : null;
  p.disposition = p.resolvedSubtype ? 'IN_SCOPE' : 'OUT_OF_SCOPE';
  if (revision === 'tdms-engineering-own-subtype@2' && subtype === 'EF')
    record.coverage.gaps.splice(
      2,
      0,
      'NATIVE_EPM_EF_NOT_EFREQUEST_OUT_OF_CURRENT_SCOPE',
    );
  env.package.coverage = copyComplete(record.coverage);
  return resealClassification(env);
}
export function syntheticEfNamedMetadata() {
  const env = syntheticFiniteEfRequest(),
    p = proofOfCurrent(env),
    m = golden.efMetadataModel;
  for (const read of p.reads) {
    read.tabs.find((t: any) => t.tabId === m.detailTabId).label = 'Details';
    for (const field of read.fields) {
      if (field.value.actualLabel !== 'Last Modified:') continue;
      const spec = m.ownIdentityFields.find(
        (s: any) => field.sectionId === m.detailTabId + '::' + s.sectionId,
      );
      field.fieldId =
        m.detailPanel + ' #' + spec!.dataStoreId + ' > td.synthetic-modified';
      field.value.locator = field.fieldId;
    }
    for (const spec of [...m.ownMetadataFields, ...m.ownIdentityFields])
      for (const label of spec.labels) {
        if (
          !read.sections.some(
            (s: any) => s.sectionId === m.detailTabId + '::' + spec.sectionId,
          )
        )
          read.sections.push({
            sectionId: m.detailTabId + '::' + spec.sectionId,
            tabId: m.detailTabId,
            label: spec.sectionId,
            panelLocator: m.detailPanel + ' #' + spec.sectionId,
            state: 'VALUE',
            sourceDeclared: true,
          });
        if (
          read.fields.some(
            (f: any) =>
              f.sectionId === m.detailTabId + '::' + spec.sectionId &&
              f.value.actualLabel === label,
          )
        )
          continue;
        const locator =
          m.detailPanel +
          ' #' +
          spec.dataStoreId +
          ' > tbody > tr.synthetic-' +
          read.fields.length +
          ' > td.attributePanel-value';
        read.fields.push({
          fieldId: locator,
          tabId: m.detailTabId,
          sectionId: m.detailTabId + '::' + spec.sectionId,
          labelOrigin: 'NATIVE_SOURCE_DECLARED',
          nativeControl: { tag: 'TD', readOnly: null, disabled: null },
          value: value(label, 'Synthetic ' + label, locator),
          links: [],
        });
      }
    efRequestStructuralRosters(read);
  }
  return resealEfRequest(env);
}
export function syntheticAdUnknownBusiness() {
  const env = syntheticCompleteEnvelope('AD'),
    p = proofOfCurrent(env),
    g = finiteModelsGolden;
  for (const read of p.reads) {
    const m = g.adModel;
    read.owner.businessVersion = null;
    read.owner.businessVersionEvidence = value(
      'Business Version:',
      null,
      m.detailPanel + ' [unreviewed-business-version-model]',
    );
    read.tabs = [
      {
        ...read.tabs.find((t: any) => t.tabId === m.detailTabId),
        state: 'VALUE',
      },
    ];
    read.sections = copyComplete(g.adSections);
    read.fields = copyComplete(g.adFields);
    for (const f of read.fields) {
      f.value.rawValue = read.owner.sourceModifiedRaw;
      f.value.observedTotalCodepoints = [...f.value.rawValue].length;
    }
    read.rosterEvidence.tabIds = [m.detailTabId];
    efRequestStructuralRosters(read);
  }
  return resealMetadata(env);
}
export const currentRecordHash = (env: any) => hash(env.package.records[0]);
