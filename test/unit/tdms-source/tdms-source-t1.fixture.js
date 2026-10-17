import {
  copyComplete,
  syntheticCompleteEnvelope,
  sealComplete,
} from './tdms-complete-owned.fixture';
import {
  proofOfCurrent,
  resealClassification,
} from './tdms-current-contract.fixture';
import { efRequestStructuralRosters } from './tdms-efrequest-contract.fixture';
import { syntheticFiniteEfRequest } from './tdms-finite-required-models.fixture';
import { hash } from '../../../server/modules/tdms-source/tdms-source.validation';
import {
  completeOwnedTargetOccurrences,
  completeOwnedObservedEdges,
} from '../../../server/modules/tdms-source/tdms-complete-owned-source.validation';
import { REVIEWED_ANONYMOUS_OWN_RAW_MODELS } from '../../../server/modules/tdms-source/tdms-reviewed-anonymous-own-raw-slots';
import { REVIEWED_AD_HANDLING_NATIVE_MODEL } from '../../../server/modules/tdms-source/tdms-reviewed-ad-handling-native-model';
import { REVIEWED_AD_HANDLING_NATIVE_TREE_MODEL } from '../../../server/modules/tdms-source/tdms-reviewed-ad-handling-native-tree';

// Fabricated wire observations only. The finite native rosters are from the
// frozen 21/11 pure model; no native DOM, saved source payload or authority.
export const scalar = (
  label,
  raw,
  locator,
  state = raw === null ? 'NOT_READ' : raw.trim() ? 'VALUE' : 'BLANK',
) => ({
  state,
  actualLabel: label,
  rawValue: raw,
  locator,
  observedTotalCodepoints: raw === null ? 0 : [...raw].length,
});
export function syntheticField(
  model,
  spec,
  label,
  index,
  raw = 'Synthetic ' + label,
) {
  const locator =
    model.detailPanel +
    ' #' +
    spec.dataStoreId +
    ' > tbody > tr:nth-child(' +
    (index + 1) +
    ') > td:nth-child(3)';
  return {
    fieldId: locator,
    tabId: model.detailTabId,
    sectionId: model.detailTabId + '::' + spec.sectionId,
    labelOrigin: 'NATIVE_SOURCE_DECLARED',
    nativeControl: { tag: 'TD', readOnly: null, disabled: null },
    value: scalar(label, raw, locator),
    links: [],
  };
}
export function syntheticSections(model) {
  return model.sections.map((s) => ({
    sectionId: model.detailTabId + '::' + s.sectionId,
    tabId: model.detailTabId,
    label: s.sectionLabel,
    panelLocator: model.detailPanel + ' #' + s.sectionId,
    state: 'VALUE',
    sourceDeclared: true,
  }));
}
export function rawQualification(owner) {
  return {
    semanticPurpose: 'SEMANTIC_PURPOSE_UNKNOWN',
    ownerSourceRecordId: owner.sourceRecordId,
    ownStateRaw: owner.stateRaw,
    observedAt: owner.observedAt,
    reasonCode: ['Approved', '已批准', 'Estimated'].includes(owner.stateRaw)
      ? null
      : owner.stateRaw === 'Estimating'
        ? 'TDMS_ESTIMATING_STATE_ONLY_REQUIRED'
        : 'TDMS_OPINION_STATE_NOT_ELIGIBLE',
  };
}
export function resealT1(env) {
  const record = env.package.records[0],
    proof = proofOfCurrent(env),
    read = proof.reads[1];
  const gaps = [
    'REQUIRED_TARGET_OWN_SOURCES_PENDING',
    'COMPLETION_CERTIFICATE_NOT_ISSUED',
  ];
  if (read.owner.nativeTypeId === null) gaps.push('NATIVE_TYPE_UNOBSERVED');
  if (read.owner.sourceVersion.confirmation !== 'SOURCE_DECLARED')
    gaps.push('TECHNICAL_VERSION_UNCONFIRMED');
  if (read.relationTables.some((t) => t.enumerationState !== 'VALUE'))
    gaps.push('RELATION_ENUMERATION_UNVERIFIED');
  if (read.rosterEvidence.layoutEvidencePending)
    gaps.push('OWN_LAYOUT_REPRESENTATIVE_PENDING');
  if (
    read.rosterEvidence.unknownRequiredSurfaces.length ||
    read.rosterEvidence.unreadControls.length ||
    read.tabs.some(
      (t) =>
        t.required &&
        ['NOT_READ', 'NOT_LOADED', 'TRUNCATED', 'ACCESS_DENIED'].includes(
          t.state,
        ),
    ) ||
    read.fields.some((f) =>
      ['NOT_READ', 'NOT_LOADED', 'TRUNCATED', 'ACCESS_DENIED'].includes(
        f.value.state,
      ),
    )
  )
    gaps.push('OWN_CONTENT_UNREAD');
  record.sourceRecordId = read.owner.sourceRecordId;
  record.number = read.owner.number;
  record.sourceVersion = copyComplete(read.owner.sourceVersion);
  record.businessVersion = copyComplete(read.owner.businessVersion);
  record.state = { rawCode: null, rawName: read.owner.stateRaw };
  record.rawFields.number = read.owner.number;
  record.rawFields.storageType = {
    rawCode: null,
    rawName: read.owner.rawHeaderType,
  };
  record.rawFields.sourceModifiedRaw = read.owner.sourceModifiedRaw;
  record.content.completeOwnedFields = copyComplete(read.fields);
  record.provenance[0].observationRef = read.owner.sourceRecordId;
  proof.targetOccurrences = completeOwnedTargetOccurrences(proof);
  record.coverage = { status: 'PARTIAL', gaps, readback: 'NON_ATOMIC' };
  env.package.coverage = copyComplete(record.coverage);
  sealComplete(env);
  env.package.edges = completeOwnedObservedEdges(record);
  env.requestId = 'TDMSIMPORT-' + hash(env.package);
  return env;
}
export function syntheticAnonymous(
  scopeId = 'ENGINEERING_ASSESSMENT',
  state = 'Estimated',
  raw = ' \u00a0\t',
) {
  const env =
    scopeId === 'ENGINEERING_ASSESSMENT'
      ? syntheticFiniteEfRequest()
      : syntheticCompleteEnvelope('AD');
  const p = proofOfCurrent(env),
    m = REVIEWED_ANONYMOUS_OWN_RAW_MODELS[scopeId];
  for (const read of p.reads) {
    const tab = read.tabs.find((t) => t.tabId === m.detailTabId);
    Object.assign(tab, { label: 'Details', state: 'VALUE', reasonCode: null });
    read.sections = syntheticSections(m);
    read.owner.stateRaw = state;
    read.fields = m.sections.flatMap((spec) =>
      spec.fieldLabels.map((label, i) => {
        const field = syntheticField(
          m,
          spec,
          label,
          i,
          label === 'Last Modified:'
            ? read.owner.sourceModifiedRaw
            : /评估意见/iu.test(label)
              ? null
              : label === ''
                ? raw
                : 'Synthetic ' + label,
        );
        if (/评估意见/iu.test(label) && state !== 'Estimated')
          field.value.state = 'NOT_APPLICABLE';
        return field;
      }),
    );
    const f = read.fields[m.anonymousOccurrenceZeroBased];
    if (scopeId === 'AD') {
      f.fieldId =
        m.detailPanel +
        ' #dataStoreMoreAttributesGroup > tbody > tr:nth-child(1) > td:nth-child(6)';
      f.value.locator = f.fieldId;
      // Retain the prior explicit unknown AD business model, not a guessed revision.
      read.owner.businessVersion = null;
      read.owner.businessVersionEvidence = scalar(
        'Business Version:',
        null,
        m.detailPanel + ' [unreviewed-business-version-model]',
      );
    }
    f.rawCaptionText = ' \u00a0 ';
    f.rawTextQualification = rawQualification(read.owner);
    if (!['Approved', '已批准', 'Estimated'].includes(state))
      f.value = scalar('', null, f.fieldId);
    read.rosterEvidence.unknownRequiredSurfaces = read.fields
      .filter((field) =>
        ['NOT_READ', 'NOT_LOADED', 'TRUNCATED', 'ACCESS_DENIED'].includes(
          field.value.state,
        ),
      )
      .map((field) => field.fieldId);
    if (read.rosterEvidence.unknownRequiredSurfaces.length)
      tab.state = 'NOT_READ';
    read.rosterEvidence.tabIds = read.tabs.map((t) => t.tabId);
    if (read.rosterEvidence.nativeTabStripIds)
      read.rosterEvidence.nativeTabStripIds = [
        ...read.rosterEvidence.tabIds,
        'infoPageinfoPanelID__new_tab_action',
      ];
    t1StructuralRosters(read);
  }
  return resealT1(env);
}
export function syntheticHandling() {
  const env = syntheticCompleteEnvelope('AD_ITEM', 991002),
    p = proofOfCurrent(env);
  const m = REVIEWED_AD_HANDLING_NATIVE_MODEL,
    ref = 'OR:wt.change2.WTChangeRequest2:991002';
  Object.assign(p, { scopeId: 'AD_HANDLING_FORM' });
  Object.assign(p.requestedCriteria, {
    scopeId: 'AD_HANDLING_FORM',
    sourceObjectRef: ref,
    documentCode: 'SYNTHETIC-HANDLING-1',
  });
  p.requestedCriteria.expectedOwner = {
    nativeTypeId: null,
    sourceVersion: {
      rawRevision: null,
      rawIteration: null,
      confirmation: 'VERSION_UNCONFIRMED',
    },
    sourceModifiedRaw: '2026-10-12 08:00',
  };
  p.requestedCriteria.sourceProof.targetRef = ref;
  p.requestedCriteria.sourceProof.classificationOperationId =
    'TDMSOP-22222222-2222-2222-2222-222222222222';
  for (const read of p.reads) {
    Object.assign(read.owner, {
      sourceRecordId: ref,
      number: 'SYNTHETIC-HANDLING-1',
      nativeTypeId: null,
      nativeTypeEvidence: scalar('Native type', null, '#type'),
      rawHeaderType: m.nativeHeaderType,
      rawHeaderIdentifier: 'SYNTHETIC-HANDLING-1',
      sourceVersion: copyComplete(
        p.requestedCriteria.expectedOwner.sourceVersion,
      ),
      technicalVersionEvidence: scalar(
        'Version:',
        null,
        m.detailPanel + ' [expected-label=Version:]',
        'ABSENT',
      ),
      technicalVersionFieldEvidence: scalar(
        'Version:',
        null,
        m.detailPanel + ' [expected-label=Version:]',
        'ABSENT',
      ),
      businessVersion: {
        rawRevision: '1',
        rawIteration: null,
        confirmation: 'SOURCE_DECLARED',
      },
      sourceCreatedRaw: '2026-10-11 08:00',
      stateRaw: 'Estimated',
    });
    read.tabs = m.tabs.map((t) => ({
      ...copyComplete(t),
      state: t.tabId === m.detailTabId ? 'VALUE' : 'NOT_READ',
      required: true,
      sourceDeclared: true,
      reasonCode:
        t.tabId === m.detailTabId ? null : 'NATIVE_SURFACE_UNREVIEWED',
    }));
    read.sections = syntheticSections(m);
    read.fields = m.sections.flatMap((spec) =>
      spec.fieldLabels.map((label, i) => {
        const field = syntheticField(
          m,
          spec,
          label,
          i,
          label === 'AD处理单编号:'
            ? 'SYNTHETIC-HANDLING'
            : label === 'AD处理单版本:'
              ? '1'
              : label === 'Last Modified:'
                ? read.owner.sourceModifiedRaw
                : label === 'Created On:'
                  ? read.owner.sourceCreatedRaw
                  : m.unreviewedTextFields.some(
                        (s) =>
                          s.sectionId === spec.sectionId && s.label === label,
                      )
                    ? null
                    : 'Synthetic ' + label,
        );
        if (
          m.unreviewedTextFields.some(
            (s) => s.sectionId === spec.sectionId && s.label === label,
          )
        )
          field.rawTextQualification = rawQualification(read.owner);
        return field;
      }),
    );
    read.owner.businessVersionEvidence = copyComplete(
      read.fields.find(
        (f) =>
          f.sectionId.endsWith('::General') &&
          f.value.actualLabel === 'AD处理单版本:',
      ).value,
    );
    const c = m.nonContentControl;
    read.rosterEvidence = {
      tabRosterSource: 'OWN_INFOPAGE_TAB_STRIP',
      tabIds: read.tabs.map((t) => t.tabId),
      structuralRosters: [],
      unreadControls: [],
      unknownRequiredSurfaces: [],
      layoutEvidencePending: true,
      nativeTabStripIds: [...read.tabs.map((t) => t.tabId), c.actionId],
      nonContentControls: [
        {
          actionId: c.actionId,
          tag: c.tag,
          rawClassName: null,
          rawClassEvidenceState: 'NOT_READ',
          rawCaption: '',
          tagQuery: c.tagQuery,
          locator: '#' + c.actionId,
          rootLocator: m.rootLocator,
          semantic: c.semantic,
          modelRevision: m.modelRevision,
        },
      ],
    };
    read.relationTables = [];
    t1StructuralRosters(read);
  }
  env.package.records[0].kind = 'PROCESSING_SHEET';
  p.nativeReloadProvenance.sourceRecordId = ref;
  env.package.query.requestedCriteria = {
    documentCode: 'SYNTHETIC-HANDLING-1',
    sourceObjectRef: ref,
    objectType: 'AD处理单',
    nativeClass: 'wt.change2.WTChangeRequest2',
  };
  return resealT1(env);
}
export function syntheticHandlingTree() {
  const env = syntheticHandling(),
    p = proofOfCurrent(env),
    m = REVIEWED_AD_HANDLING_NATIVE_TREE_MODEL;
  for (const read of p.reads) {
    const refs = [
      'OR:wt.doc.WTDocument:991001',
      read.owner.sourceRecordId,
      'OR:wt.change2.WTChangeOrder2:991003',
      'OR:wt.change2.WTChangeActivity2:991004',
    ];
    const rows = refs.map((targetRef, depth) => {
      const number =
        depth === 1 ? read.owner.number : 'SYNTHETIC-TREE-' + depth;
      return {
        occurrenceId: m.gridId + ':TREE:' + targetRef,
        globalIndex: null,
        nativeRowId: 'row-' + depth,
        treePath: refs.slice(0, depth + 1),
        treeDepth: depth,
        nativeRelationId: null,
        rawRole: null,
        rawDirection: null,
        cells: m.columns.map((c, i) => ({
          actualLabel: c.actualLabel,
          state: i === 1 ? 'VALUE' : 'NOT_READ',
          rawValue: i === 1 ? number : null,
          observedTotalCodepoints: i === 1 ? number.length : 0,
        })),
        sourceLinks: [
          {
            rawHref: '/Windchill/tcomp/infoPage?oid=' + targetRef,
            targetRef,
            numberRaw: number,
            nativeRole: m.numberRole,
            locator: m.panelLocator + ' #row-' + depth + ' a.number',
            nativeColumnLabel: 'Number',
            nativeColumnToken: 'number',
          },
        ],
        observedVersion: {
          rawRevision: null,
          rawIteration: null,
          confirmation: 'VERSION_UNCONFIRMED',
        },
      };
    });
    const rowShapes = rows.map((r, i) => ({
      occurrenceId: r.occurrenceId,
      rowClass: 'x-grid3-row ux-maximgb-tg-level-' + i,
      numberCellClass: 'x-grid3-col x-grid3-cell x-grid3-td-number',
      levelClass: 'ux-maximgb-tg-level-' + i,
      uiWrap: {
        class: 'ux-maximgb-tg-uiwrap',
        style: 'width: ' + 16 * (i + 1) + 'px;',
      },
      elbows: Array.from({ length: i + 1 }, (_, j) => ({
        class:
          j < i
            ? 'ux-maximgb-tg-elbow-empty'
            : i === 3
              ? 'ux-maximgb-tg-elbow-end'
              : m.collapsedControl.expandedClass,
        style: 'left: ' + (j === i ? 1 + 16 * i : 16 * j) + 'px;',
      })),
      numberLink: {
        rawHref: r.sourceLinks[0].rawHref,
        locator: r.sourceLinks[0].locator,
        targetRef: r.sourceLinks[0].targetRef,
      },
    }));
    read.relationTables = [
      {
        tableId: m.gridId,
        gridId: m.gridId,
        tabId: m.tabId,
        tableTitle: m.tableTitle,
        panelLocator: m.panelLocator,
        relationshipRole: 'CURRENT_CONTENT',
        direction: 'UNKNOWN',
        rawHeaders: m.columns.map((c) => c.actualLabel),
        reportedTotal: 4,
        countEvidence: {
          rawText: '(4 objects)',
          exact: false,
          locator: m.panelLocator + ' span.tableCount',
        },
        scanMode: 'TREE',
        rows,
        windows: [
          {
            ordinal: 0,
            rowOccurrenceIds: rows.map((r) => r.occurrenceId),
            globalIndices: [],
            reportedTotal: 4,
            pageRaw: null,
            scroll: null,
            nextControl: {
              present: false,
              enabled: false,
              terminalDeclared: false,
            },
            stableReads: 2,
            treePending: 1,
            observedAt: read.observedAt,
          },
        ],
        treeExpansions: [],
        terminal: {
          kind: 'UNCONFIRMED',
          total: 4,
          captured: 4,
          allGlobalIndices: false,
          allTreeNodesExpanded: false,
          nativeTerminal: false,
          trueZero: false,
          settledReads: 2,
        },
        enumerationState: 'NOT_READ',
        stopReason: m.stopReason,
        ownerSourceRecordId: read.owner.sourceRecordId,
        ownerSourceVersion: copyComplete(read.owner.sourceVersion),
        observedAt: read.observedAt,
        nativeTreeEvidence: {
          modelRevision: m.modelRevision,
          columns: m.columns.map(({ actualLabel, nativeColumnToken }) => ({
            actualLabel,
            nativeColumnToken,
          })),
          rowShapes,
          titleRaw: 'AD RelationShip (4 objects)',
        },
      },
    ];
  }
  // Expected occurrences and edges are asserted independently in the spec.
  return resealT1(env);
}
export function syntheticHandlingClassification() {
  const env = syntheticHandling(),
    p = proofOfCurrent(env),
    owner = p.reads[1].owner;
  const sourceProof = copyComplete(p.requestedCriteria.sourceProof);
  delete sourceProof.classificationOperationId;
  const input = {
    profileId: 'REQUIRED_AD_HANDLING_TARGET',
    profileRevision: 'tdms-required-ad-handling-target@1',
    originalReferenceLabel: owner.number,
    sourceObjectRef: owner.sourceRecordId,
    expectedOwner: copyComplete(p.requestedCriteria.expectedOwner),
    sourceProof,
    purpose: 'COVERAGE',
    primaryPolicy: 'METADATA_ONLY',
    openIfMissing: false,
    classificationRevision: 'tdms-required-ad-handling-own-classification@1',
  };
  const o = {
    schemaVersion: 'wiselink.tdms-required-ad-handling-own-classification.v1',
    classificationRevision: input.classificationRevision,
    requestedCriteria: input,
    documentIdentity: p.documentIdentity,
    nativeReloadProvenance: p.nativeReloadProvenance,
    reads: p.reads.map((r) => ({
      owner: r.owner,
      sourceContext: r.sourceContext,
      observedAt: r.observedAt,
      ownMetadataFields: r.fields.filter((f) =>
        REVIEWED_AD_HANDLING_NATIVE_MODEL.businessMetadata.some(
          (s) =>
            f.value.actualLabel === s.label &&
            f.sectionId.endsWith('::' + s.sectionId),
        ),
      ),
    })),
    resolvedScopeId: 'AD_HANDLING_FORM',
    disposition: 'IN_SCOPE',
  };
  const coverage = {
    status: 'PARTIAL',
    gaps: [
      'REQUIRED_AD_HANDLING_NATIVE_CLASSIFICATION_ONLY',
      'OWN_COMPLETE_CONTENT_NOT_READ',
    ],
    readback: 'NON_ATOMIC',
  };
  env.package.records = [
    {
      sourceRecordId: owner.sourceRecordId,
      kind: 'OBSERVATION',
      number: owner.number,
      sourceVersion: owner.sourceVersion,
      businessVersion: owner.businessVersion,
      state: { rawCode: null, rawName: owner.stateRaw },
      observedAt: o.reads[1].observedAt,
      sourceModifiedAt: null,
      authors: [],
      rawFields: {
        number: owner.number,
        storageType: { rawCode: null, rawName: owner.rawHeaderType },
        sourceModifiedRaw: owner.sourceModifiedRaw,
        documentTargetClassification: o,
      },
      content: {},
      provenance: [
        {
          fieldPath: 'rawFields.documentTargetClassification',
          selector: '#infoPageIdentityDisplayType',
          sourceModifiedAt: null,
          observationRef: owner.sourceRecordId,
        },
      ],
      coverage,
    },
  ];
  env.package.coverage = copyComplete(coverage);
  return resealClassification(env);
}

export function t1StructuralRosters(read) {
  efRequestStructuralRosters(read);
  for (const tab of read.tabs) {
    if (
      read.rosterEvidence.structuralRosters.some((r) => r.tabId === tab.tabId)
    )
      continue;
    const fields = read.fields.filter((f) => f.tabId === tab.tabId);
    if (!fields.length) continue;
    const sections = read.sections.filter((s) => s.tabId === tab.tabId);
    const roster = {
      fieldIds: fields.map((f) => f.fieldId),
      sectionIds: sections.map((s) => s.sectionId),
      fieldLocators: fields.map((f) => f.value.locator),
      sectionLocators: sections.map((s) => s.panelLocator),
      declaredFieldCount: fields.length,
      declaredSectionCount: sections.length,
      loadingPresent: false,
      terminal: 'DOM_TREE_END',
    };
    read.rosterEvidence.structuralRosters.push({
      tabId: tab.tabId,
      before: roster,
      after: copyComplete(roster),
      settledReads: 2,
    });
  }
}
