import golden from '../../fixtures/tdms-source/finite-required-models-producer-qualified.synthetic.json';
import { completeOwnedTargetOccurrences } from '../../../server/modules/tdms-source/tdms-complete-owned-source.validation';
import {
  copyComplete,
  syntheticCompleteEnvelope,
  withCompleteRelation,
} from './tdms-complete-owned.fixture';
import {
  efRequestProof,
  efRequestStructuralRosters,
  resealEfRequest,
  syntheticEfRequest,
} from './tdms-efrequest-contract.fixture';
import { proofOfCurrent, resealCurrent } from './tdms-current-contract.fixture';

// Only fabricated DTOs. Native model literals/expected helper results came from
// the two SHA-qualified pure Source helpers, never collector or actual payload.
export const finiteModelsGolden = golden;
export function syntheticFiniteEfRequest(rows = false) {
  const env = syntheticEfRequest(),
    proof = efRequestProof(env),
    m = golden.efModel;
  for (const read of proof.reads) {
    for (const spec of m.nativeGridSurfaces) {
      const existing = read.tabs.find((t: any) => t.tabId === spec.tabId);
      if (existing) existing.panelLocator = spec.panelLocator;
      else
        read.tabs.push({
          tabId: spec.tabId,
          label: spec.gridId,
          panelLocator: spec.panelLocator,
          state: 'VALUE',
          required: true,
          sourceDeclared: true,
          reasonCode: null,
        });
    }
    read.tabs.push(
      ...m.scopeExcludedTabs.map((t) => ({
        ...copyComplete(t),
        required: false,
        state: 'NOT_READ',
        sourceDeclared: true,
        reasonCode: m.scopeExcludedTabReason,
      })),
    );
    read.rosterEvidence.tabIds = read.tabs.map((t: any) => t.tabId);
    read.rosterEvidence.nativeTabStripIds = [
      ...read.rosterEvidence.tabIds,
      m.nonContentControl.actionId,
    ];
    read.relationTables = m.nativeGridSurfaces.map((spec, index) => {
      const occurrenceId = spec.gridId + ':synthetic-0';
      return {
        tableId: 'synthetic-ef-grid-' + index,
        tabId: spec.tabId,
        tableTitle: spec.gridId,
        panelLocator: spec.panelLocator,
        gridId: spec.gridId,
        relationshipRole: 'UNKNOWN',
        direction: 'UNKNOWN',
        rawHeaders: spec.columns.map((c) => c.actualLabel),
        reportedTotal: rows ? 1 : 0,
        countEvidence: {
          rawText: rows ? '(1 object)' : '(0 objects)',
          exact: true,
          locator: spec.panelLocator + ' #' + spec.gridId + ' .tableCount',
        },
        scanMode: 'DOM_ROWS',
        rows: rows
          ? [
              {
                occurrenceId,
                globalIndex: 0,
                nativeRowId: 'synthetic-row-0',
                treePath: [],
                treeDepth: null,
                nativeRelationId: null,
                rawRole: null,
                rawDirection: null,
                cells: spec.columns.map((c) => ({
                  actualLabel: c.actualLabel,
                  rawValue: c.valuePolicy.startsWith('NOT_READ')
                    ? null
                    : 'Synthetic native cell',
                  state: c.valuePolicy.startsWith('NOT_READ')
                    ? 'NOT_READ'
                    : 'VALUE',
                  observedTotalCodepoints: c.valuePolicy.startsWith('NOT_READ')
                    ? 0
                    : 21,
                })),
                sourceLinks: [],
                observedVersion: {
                  rawRevision: null,
                  rawIteration: null,
                  confirmation: 'VERSION_UNCONFIRMED',
                },
              },
            ]
          : [],
        windows: [
          {
            ordinal: 0,
            rowOccurrenceIds: rows ? [occurrenceId] : [],
            globalIndices: rows ? [0] : [],
            reportedTotal: rows ? 1 : 0,
            pageRaw: null,
            scroll: null,
            nextControl: {
              present: false,
              enabled: false,
              terminalDeclared: true,
            },
            stableReads: 2,
            treePending: 0,
            observedAt: read.observedAt,
          },
        ],
        treeExpansions: [],
        terminal: {
          kind: 'NATIVE_END',
          total: rows ? 1 : 0,
          captured: rows ? 1 : 0,
          allGlobalIndices: true,
          allTreeNodesExpanded: true,
          nativeTerminal: true,
          trueZero: !rows,
          settledReads: 2,
        },
        enumerationState: 'VALUE',
        stopReason: null,
        ownerSourceRecordId: read.owner.sourceRecordId,
        ownerSourceVersion: copyComplete(read.owner.sourceVersion),
        observedAt: read.observedAt,
      };
    });
    efRequestStructuralRosters(read);
  }
  return resealEfRequest(env);
}

export function syntheticFiniteRawControl(control?: any) {
  const env = withCompleteRelation(syntheticCompleteEnvelope('EO')),
    proof = proofOfCurrent(env);
  for (const read of proof.reads) {
    const table = read.relationTables[0],
      raw = golden.sourceView;
    table.tabId = raw.tabId;
    table.panelLocator = raw.panelLocator;
    table.gridId = raw.gridId;
    table.sourceViewEvidence = {
      ...copyComplete(raw),
      ownerSourceRecordId: read.owner.sourceRecordId,
      ownerTechnicalVersion: copyComplete(read.owner.sourceVersion),
      ownerBusinessVersion: copyComplete(read.owner.businessVersion),
      ...(control === undefined
        ? {}
        : { rawControlObservations: copyComplete(control) }),
    };
    read.tabs.push({
      ...read.tabs[0],
      tabId: table.tabId,
      panelLocator: table.panelLocator,
      label: 'Related Status',
    });
    read.rosterEvidence.tabIds.push(table.tabId);
    const empty = {
      fieldIds: [],
      sectionIds: [],
      fieldLocators: [],
      sectionLocators: [],
      declaredFieldCount: 0,
      declaredSectionCount: 0,
      loadingPresent: false,
      terminal: 'DOM_TREE_END',
    };
    read.rosterEvidence.structuralRosters.push({
      tabId: table.tabId,
      before: empty,
      after: copyComplete(empty),
      settledReads: 2,
    });
    const link = table.rows[0].sourceLinks[0];
    Object.assign(link, {
      targetRef: 'OR:com.airchina.tdms.statuslink.TDMSStatusLink:999',
      nativeRole: 'STATUS_LINK',
      nativeColumnToken: 'number',
      locator: table.panelLocator + ' #' + table.gridId + ' number',
    });
    link.rawHref = '/infoPage?oid=' + link.targetRef;
  }
  proof.targetOccurrences = completeOwnedTargetOccurrences(proof);
  const occurrence = proof.targetOccurrences[0];
  Object.assign(env.package.edges[0], {
    toSourceRecordId: occurrence.targetRef,
    evidenceLocator: occurrence.locator,
  });
  return resealCurrent(env);
}
