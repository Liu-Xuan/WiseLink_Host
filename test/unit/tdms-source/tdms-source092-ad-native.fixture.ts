import reference from '../../fixtures/tdms-source/source092-ad-same-row-model.json';
import { copyComplete } from './tdms-complete-owned.fixture';
import { current092Envelope, sbProof, structuralRoster, type Source092Field, type Source092Read, type Source092RelationTable } from './tdms-source092-dto.fixture';
import { completeOwnedObservedEdges, completeOwnedRecord } from '../../../server/modules/tdms-source/tdms-complete-owned-source.validation';
import { hash } from '../../../server/modules/tdms-source/tdms-source.validation';
import type { TdmsDailyMetadataRecord, TdmsDailyObservedEdge } from '../../../server/modules/tdms-source/tdms-daily-metadata-contract';
import type { TdmsSourceVersion } from '../../../shared/tdms-source.interface';

interface Source092AdRow {
  occurrenceId: string; nativeRowId: string | null; rowLocator: string; rawClassName: string;
  number: Source092Field['value']; businessNumber: Source092Field['value'];
  businessVersion: Source092Field['value']; name: Source092Field['value'];
  numberLink: Source092Field['links'][number];
}
interface Source092AdTable extends Source092RelationTable {
  relatedSurfaceEvidence?: {
    ownerSourceVersion: TdmsSourceVersion;
    before: { rows: Source092AdRow[]; [key: string]: unknown };
    after: { rows: Source092AdRow[]; [key: string]: unknown };
    [key: string]: unknown;
  };
}
export type Source092AdRead = Source092Read<Source092AdTable>;

/** Current Source0.2.92 AD native same-row DTO, independently synthetic; no DOM/worker. */
export function current092AdObservation(rawVersion = '\u00a0', self = true) {
  const env = current092Envelope('AD', 'FULL');
  const proof = sbProof<Source092AdRead>(env), model = reference.model;
  for (const read of proof.reads) {
    const owner = read.owner;
    const tab = { tabId: model.tabId, label: 'SYNTHETIC AD native relation', panelLocator: model.panelLocator,
      state: 'NOT_READ', required: true, sourceDeclared: true, reasonCode: model.stopReason };
    read.tabs.push(tab);
    const rawHeaderName = owner.rawHeaderIdentifier.split(',')[1].trim();
    const rowLocator = model.panelLocator + ' #' + model.gridIds[0] + ' .synthetic-row-0';
    const target = self ? owner.sourceRecordId : 'OR:wt.doc.WTDocument:92999';
    const href = '/Windchill/app/#ptc1/tcomp/infoPage?oid=' + target;
    const link = { rawHref: href, targetRef: target, numberRaw: owner.number, nativeRole: 'RELATED',
      nativeColumnLabel: 'Number', nativeColumnToken: 'number', locator: rowLocator + ' a.number' };
    const cellValue = (column: number, raw: string): Source092Field['value'] => ({ state: raw.trim() ? 'VALUE' : 'BLANK',
      actualLabel: model.columns[column].actualLabel, rawValue: raw,
      locator: rowLocator + ' td.x-grid3-cell[class~="x-grid3-td-' + model.columns[column].nativeColumnToken + '"]',
      observedTotalCodepoints: [...raw].length });
    const number = cellValue(0, owner.number), businessNumber = cellValue(1, owner.number),
      businessVersion = cellValue(2, rawVersion), name = cellValue(4, rawHeaderName);
    const values = [number, businessNumber, businessVersion, cellValue(3, ''), name,
      cellValue(5, owner.stateRaw), cellValue(6, 'SYNTHETIC USER'), cellValue(7, owner.sourceModifiedRaw)];
    const typed = { occurrenceId: 'SYNTHETIC-AD-SAME-ROW-0', globalIndex: null, nativeRowId: 'SYNTHETIC-ROW-0',
      treePath: [], treeDepth: null, nativeRelationId: null, rawRole: null, rawDirection: null,
      cells: values.map(value => ({ actualLabel: value.actualLabel, state: value.state,
        rawValue: value.state === 'BLANK' ? '' : value.rawValue,
        observedTotalCodepoints: value.state === 'BLANK' ? 0 : value.observedTotalCodepoints })),
      sourceLinks: [link], observedVersion: { rawRevision: null, rawIteration: null, confirmation: 'VERSION_UNCONFIRMED' as const } };
    const table: Source092AdTable = { tableId: 'SYNTHETIC-AD-SAME-ROW-TABLE', tabId: model.tabId,
      tableTitle: 'SYNTHETIC AD native relation', panelLocator: model.panelLocator, gridId: model.gridIds[0],
      relationshipRole: 'UNKNOWN', direction: 'UNKNOWN', rawHeaders: model.columns.map(c => c.actualLabel),
      reportedTotal: null, countEvidence: { rawText: null, exact: false, locator: model.panelLocator + ' .tableCount' },
      scanMode: 'DOM_ROWS', rows: [typed], windows: [{ ordinal: 0, rowOccurrenceIds: [typed.occurrenceId],
        globalIndices: [], reportedTotal: null, pageRaw: null, scroll: null,
        nextControl: { present: false, enabled: false, terminalDeclared: false }, stableReads: 2,
        treePending: 0, observedAt: read.observedAt }], treeExpansions: [],
      terminal: { kind: 'UNCONFIRMED', total: null, captured: 1, allGlobalIndices: false,
        allTreeNodesExpanded: false, nativeTerminal: false, trueZero: false, settledReads: 2 },
      enumerationState: 'NOT_READ', stopReason: model.stopReason,
      ownerSourceRecordId: owner.sourceRecordId, ownerSourceVersion: copyComplete(owner.sourceVersion),
      observedAt: read.observedAt };
    const frame = { activeTabId: model.tabId, panelId: model.panelLocator.slice(1), gridId: model.gridIds[0],
      columns: copyComplete(model.columns), rows: [{ occurrenceId: typed.occurrenceId, nativeRowId: typed.nativeRowId,
        rowLocator, rawClassName: 'x-grid3-row', number, businessNumber, businessVersion, name, numberLink: link }] };
    table.relatedSurfaceEvidence = { schemaVersion: model.schemaVersion, modelRevision: model.modelRevision,
      scopeId: 'AD', ownerSourceRecordId: owner.sourceRecordId, ownerSourceVersion: copyComplete(owner.sourceVersion),
      ownerNumber: owner.number, ownStateRaw: owner.stateRaw, ownerSourceModifiedRaw: owner.sourceModifiedRaw,
      nativeTypeId: owner.nativeTypeId, tabId: model.tabId, panelLocator: model.panelLocator, gridId: model.gridIds[0],
      queryReviewState: 'NOT_READ', before: frame, after: copyComplete(frame), settledReads: 2 };
    read.relationTables = [table];
    const declared = rawVersion.trim() ? rawVersion : '';
    owner.businessVersion = declared ? { rawRevision: declared, rawIteration: null, confirmation: 'SOURCE_DECLARED' } : null;
    owner.businessVersionEvidence = { ...businessVersion, state: declared ? 'VALUE' : 'BLANK', rawValue: declared,
      observedTotalCodepoints: [...declared].length };
    read.rosterEvidence.tabIds = read.tabs.map(t => t.tabId);
    read.rosterEvidence.unknownRequiredSurfaces.push(model.panelLocator);
    read.rosterEvidence.structuralRosters = read.tabs.filter(t => t.state === 'VALUE')
      .map(t => structuralRoster(read, t.tabId));
  }
  return { schemaVersion: proof.schemaVersion, requestedCriteria: proof.requestedCriteria,
    documentIdentity: proof.documentIdentity, nativeReloadProvenance: proof.nativeReloadProvenance, reads: proof.reads };
}

/** Host assembly for adapter integration; the separate Source hash vectors are the identity oracle. */
export function current092AdEnvelope(rawVersion = '\u00a0') {
  const env = current092Envelope('AD', 'FULL');
  const observation = current092AdObservation(rawVersion);
  // The JS functions add snapshotId/edgeId after object construction; their inferred types omit those assignments.
  const record = completeOwnedRecord(observation, observation.requestedCriteria) as unknown as TdmsDailyMetadataRecord;
  env.package.records = [record];
  env.package.edges = completeOwnedObservedEdges(record) as TdmsDailyObservedEdge[];
  env.package.coverage = copyComplete(record.coverage);
  env.requestId = 'TDMSIMPORT-' + hash(env.package);
  return env;
}
