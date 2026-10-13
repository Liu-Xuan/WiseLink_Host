import { hash } from '../../../server/modules/tdms-source/tdms-source.validation';
import { completeOwnedTargetOccurrences } from '../../../server/modules/tdms-source/tdms-complete-owned-source.validation';
import { RELATED_STATUS_FIXED_ROW_SLOT_MODEL } from '../../../server/modules/tdms-source/tdms-related-status-fixed-row-slots';
import {
  copyComplete,
  completeComparison,
  sealComplete,
  syntheticCompleteEnvelope,
} from './tdms-complete-owned.fixture';

// Fabricated DTOs only. No Source sample, collector, import or authority runs.
export const aeoProof = (env: ReturnType<typeof syntheticCompleteEnvelope>) =>
  env.package.records[0].rawFields.completeOwnedSource as any;

export function resealAeo(env: ReturnType<typeof syntheticCompleteEnvelope>) {
  const r = env.package.records[0],
    proof = aeoProof(env);
  const observation = {
    schemaVersion: proof.schemaVersion,
    requestedCriteria: proof.requestedCriteria,
    documentIdentity: proof.documentIdentity,
    nativeReloadProvenance: proof.nativeReloadProvenance,
    reads: proof.reads,
  };
  proof.targetOccurrences = completeOwnedTargetOccurrences(observation);
  r.content.completeOwnedFields = copyComplete(proof.reads[1].fields);
  r.sourceVersion = copyComplete(proof.reads[1].owner.sourceVersion);
  r.businessVersion = copyComplete(proof.reads[1].owner.businessVersion);
  sealComplete(env);
  const ids = new Set<string>();
  env.package.edges = proof.targetOccurrences
    .filter((o: any) => o.origin === 'RELATION_TABLE')
    .flatMap((o: any) => {
      const e = {
        fromSourceRecordId: r.sourceRecordId,
        toSourceRecordId: o.targetRef,
        fromSnapshotId: r.snapshotId,
        toSnapshotId: null,
        nativeRelationId: null,
        relationKind: o.tableId,
        evidenceLocator: o.locator,
        observedAt: r.observedAt,
        confidence: 'observed_unresolved' as const,
      };
      const edgeId = 'TDMSEDGE-' + hash(completeComparison(e));
      if (ids.has(edgeId)) return [];
      ids.add(edgeId);
      return [{ edgeId, ...e }];
    });
  env.requestId = 'TDMSIMPORT-' + hash(env.package);
  return env;
}

export function syntheticAeoEnvelope(rowCount = 2) {
  const env = syntheticCompleteEnvelope('EO', 990001),
    r = env.package.records[0];
  const proof = aeoProof(env),
    input = proof.requestedCriteria;
  proof.scopeId = input.scopeId = 'AEO';
  const technical = {
    rawRevision: 'N',
    rawIteration: '3',
    confirmation: 'SOURCE_DECLARED',
  };
  input.expectedOwner.sourceVersion = copyComplete(technical);
  const read = proof.reads[0];
  Object.assign(read.owner, {
    sourceVersion: copyComplete(technical),
    rawHeaderIdentifier: r.number + ', N.3',
    businessVersion: {
      rawRevision: 'R17',
      rawIteration: null,
      confirmation: 'SOURCE_DECLARED',
    },
  });
  read.owner.technicalVersionEvidence.rawValue = 'N.3';
  read.owner.technicalVersionEvidence.observedTotalCodepoints = 3;
  read.owner.scopeEvidence.engineeringSubtype = 'AEO';
  const tabId = 'infoPageinfoPanelID__syntheticDetails';
  const locator =
    '#syntheticDetails #dataStorePrimary_Attributes td.own-number';
  const rawValue = r.number + '-R17';
  read.owner.businessVersionEvidence = {
    state: 'VALUE',
    actualLabel: 'EO编号:',
    rawValue,
    locator,
    observedTotalCodepoints: [...rawValue].length,
  };
  const field = {
    fieldId: locator,
    tabId,
    sectionId: tabId + '::Primary_Attributes',
    labelOrigin: 'NATIVE_SOURCE_DECLARED',
    nativeControl: { tag: 'TD', readOnly: null, disabled: null },
    value: copyComplete(read.owner.businessVersionEvidence),
    links: [],
  };
  read.fields.push(field);
  read.tabs.push({
    tabId,
    label: 'Synthetic native attributes',
    panelLocator: '#syntheticDetails',
    state: 'VALUE',
    required: true,
    sourceDeclared: true,
    reasonCode: null,
  });
  read.sections.push({
    sectionId: field.sectionId,
    tabId,
    label: 'Primary_Attributes',
    panelLocator: '#syntheticDetails #dataStorePrimary_Attributes',
    state: 'VALUE',
    sourceDeclared: true,
  });
  read.rosterEvidence.tabIds.push(tabId);
  const roster = {
    fieldIds: [field.fieldId],
    sectionIds: [field.sectionId],
    fieldLocators: [locator],
    sectionLocators: ['#syntheticDetails #dataStorePrimary_Attributes'],
    declaredFieldCount: 1,
    declaredSectionCount: 1,
    loadingPresent: false,
    terminal: 'DOM_TREE_END',
  };
  read.rosterEvidence.structuralRosters.push({
    tabId,
    before: roster,
    after: copyComplete(roster),
    settledReads: 2,
  });
  const m = RELATED_STATUS_FIXED_ROW_SLOT_MODEL;
  read.tabs.push({
    tabId: m.tabId,
    label: 'Synthetic latest status',
    panelLocator: m.panelLocator,
    state: 'VALUE',
    required: true,
    sourceDeclared: true,
    reasonCode: null,
  });
  read.rosterEvidence.tabIds.push(m.tabId);
  const emptyRoster = {
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
    tabId: m.tabId,
    before: emptyRoster,
    after: copyComplete(emptyRoster),
    settledReads: 2,
  });
  const table: any = {
    tableId: m.gridId,
    tabId: m.tabId,
    tableTitle: 'Synthetic fixed latest status',
    panelLocator: m.panelLocator,
    gridId: m.gridId,
    relationshipRole: 'CURRENT_CONTENT',
    direction: 'SOURCE_TO_TARGET',
    rawHeaders: m.columns.map((c: any) => c.actualLabel),
    reportedTotal: rowCount,
    countEvidence: {
      rawText: `(${rowCount} objects)`,
      exact: true,
      locator: m.panelLocator + ' #count',
    },
    scanMode: 'VIRTUAL_SCROLL',
    rows: [],
    windows: [],
    treeExpansions: [],
    terminal: {
      kind: 'NATIVE_END',
      total: rowCount,
      captured: rowCount,
      allGlobalIndices: true,
      allTreeNodesExpanded: true,
      nativeTerminal: true,
      trueZero: false,
      settledReads: 2,
    },
    enumerationState: 'VALUE',
    stopReason: null,
    ownerSourceRecordId: r.sourceRecordId,
    ownerSourceVersion: copyComplete(technical),
    observedAt: r.observedAt,
  };
  table.rows = Array.from({ length: rowCount }, (_, i) => {
    const targetRef =
      'OR:com.airchina.tdms.statuslink.TDMSStatusLink:' + (991000 + i);
    const linkLocator =
      m.panelLocator +
      ` #${m.gridId} .x-grid3-row:nth-child(${i + 1}) td.number a`;
    return {
      occurrenceId: m.gridId + ':ROW' + i,
      globalIndex: i,
      nativeRowId: null,
      treePath: [],
      treeDepth: null,
      nativeRelationId: null,
      rawRole: null,
      rawDirection: null,
      observedVersion: {
        rawRevision: null,
        rawIteration: null,
        confirmation: 'VERSION_UNCONFIRMED',
      },
      cells: m.columns.map((c: any) => {
        const value =
          c.actualLabel === 'Document Number'
            ? rawValue
            : c.actualLabel === 'Number'
              ? 'SYNTHETIC-STATUS-' + i
              : 'SYNTHETIC ' + i + ' ' + 'x'.repeat(96);
        return {
          actualLabel: c.actualLabel,
          rawValue: value,
          state: 'VALUE',
          observedTotalCodepoints: [...value].length,
        };
      }),
      sourceLinks: [
        {
          targetRef,
          numberRaw: 'SYNTHETIC-STATUS-' + i,
          rawHref: '/infoPage?oid=' + targetRef,
          locator: linkLocator,
          nativeRole: 'STATUS_LINK',
          nativeColumnLabel: 'Number',
          nativeColumnToken: 'number',
        },
      ],
    };
  });
  const visibleRows = Math.min(16, rowCount - 1),
    height = rowCount * 20,
    viewport = visibleRows * 20;
  const tops: number[] = [];
  for (let top = 0; top < height - viewport; top += viewport) tops.push(top);
  tops.push(height - viewport);
  table.windows = tops.map((top, ordinal) => {
    const indices = table.rows
      .filter(
        (r: any) =>
          r.globalIndex * 20 + 20 > top && r.globalIndex * 20 < top + viewport,
      )
      .map((r: any) => r.globalIndex);
    return {
      ordinal,
      rowOccurrenceIds: indices.map((i: number) => table.rows[i].occurrenceId),
      globalIndices: indices,
      reportedTotal: rowCount,
      pageRaw: null,
      scroll: {
        top,
        height,
        viewport,
        atTop: top === 0,
        atBottom: top === height - viewport,
      },
      nextControl: { present: false, enabled: false, terminalDeclared: true },
      stableReads: 2,
      treePending: 0,
      observedAt: r.observedAt,
    };
  });
  table.nativeRowSlotEvidence = {
    schemaVersion: m.schemaVersion,
    modelRevision: m.modelRevision,
    indexOrigin: m.indexOrigin,
    columns: copyComplete(m.columns),
    slotRootLocator: m.slotRootLocator,
    slotEncoding: m.slotEncoding,
    windows: table.windows.map((w: any) => {
      const side = {
        reportedTotal: rowCount,
        slots: table.rows.map((r: any) => [
          r.globalIndex,
          r.globalIndex + 1,
          r.globalIndex * 20,
          20,
          w.globalIndices.includes(r.globalIndex) ? 17 : 0,
        ]),
      };
      return {
        windowOrdinal: w.ordinal,
        before: side,
        after: copyComplete(side),
        referenceBindings: w.globalIndices.map((i: number) => ({
          globalIndex: i,
          occurrenceId: table.rows[i].occurrenceId,
          sourceLinksSha256: hash(table.rows[i].sourceLinks),
        })),
      };
    }),
  };
  read.relationTables = [table];
  proof.reads = [copyComplete(read), copyComplete(read)];
  return resealAeo(env);
}

export function nodes(value: unknown): number {
  return (
    1 +
    (value && typeof value === 'object'
      ? Object.values(value).reduce<number>((n, v) => n + nodes(v), 0)
      : 0)
  );
}
