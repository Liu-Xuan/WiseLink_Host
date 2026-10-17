import type {
  TdmsCompleteOwnedField,
  TdmsSourceVersion,
} from '../../../shared/tdms-source.interface';
import type { TdmsDailyMetadataEnvelope } from '../../../server/modules/tdms-source/tdms-daily-metadata-contract';
import { copyComplete } from './tdms-complete-owned.fixture';
import {
  syntheticAdItem,
  resealMetadata,
} from './tdms-metadata-aditem.fixture';

// Narrow test views of fabricated raw observations, not a new wire contract.
export interface SyntheticAdItemUiRow {
  occurrenceId: string;
  globalIndex: number | null;
  nativeRowId: string | null;
  treePath: string[];
  treeDepth: number | null;
  nativeRelationId: string | null;
  rawRole: string | null;
  rawDirection: string | null;
  cells: Array<Omit<TdmsCompleteOwnedField['value'], 'locator'>>;
  sourceLinks: TdmsCompleteOwnedField['links'];
  observedVersion: TdmsSourceVersion;
}
export interface SyntheticAdItemUiTable {
  gridId: string;
  panelLocator: string;
  scanMode: string;
  relationshipRole: string;
  direction: string;
  reportedTotal: number | null;
  countEvidence: { rawText: string | null; exact: boolean; locator: string };
  rows: SyntheticAdItemUiRow[];
  windows: Array<{
    ordinal: number;
    rowOccurrenceIds: string[];
    globalIndices: number[];
    reportedTotal: number | null;
  }>;
  terminal: {
    total: number | null;
    captured: number;
    kind: string;
    allGlobalIndices: boolean;
    allTreeNodesExpanded: boolean;
    nativeTerminal: boolean;
    trueZero: boolean;
  };
  enumerationState: string;
  stopReason: string | null;
  treeExpansions: unknown[];
  nativeTreeEvidence?: unknown;
}
export interface SyntheticAdItemUiRead {
  owner: {
    stateRaw: string;
    sourceVersion: TdmsSourceVersion;
    businessVersion: TdmsSourceVersion | null;
    nativeTypeId: string | null;
  };
  fields: TdmsCompleteOwnedField[];
  relationTables: SyntheticAdItemUiTable[];
}
export interface SyntheticAdItemUiProof {
  reads: SyntheticAdItemUiRead[];
  targetOccurrences: Array<{
    origin: string;
    targetRef: string;
    treePath: string[];
    relationshipRole: string;
    direction: string;
    nativeColumnToken: string | null;
    collectionPurpose?: unknown;
    sourceVersion: TdmsSourceVersion;
  }>;
}
export function adItemUiProof(
  env: TdmsDailyMetadataEnvelope,
): SyntheticAdItemUiProof {
  return env.package.records[0]!.rawFields
    .completeOwnedSource as SyntheticAdItemUiProof;
}
export function adItemUiTree(
  read: SyntheticAdItemUiRead,
): SyntheticAdItemUiTable {
  const table: SyntheticAdItemUiTable | undefined = read.relationTables.find(
    (candidate: SyntheticAdItemUiTable) => candidate.gridId === 'mytreetable',
  );
  if (!table) throw new Error('SYNTHETIC_AD_ITEM_TREE_MISSING');
  return table;
}

// Each call constructs a distinct observation; archived Source265 fixtures and
// their recorded pins stay untouched. Estimated is its own observed state.
export function syntheticAdItemPresentedTree(
  nativeIds: boolean = true,
  levels: readonly number[] = [0, 1],
): TdmsDailyMetadataEnvelope {
  const env: TdmsDailyMetadataEnvelope = syntheticAdItem();
  for (const read of adItemUiProof(env).reads) {
    read.owner.stateRaw = 'Estimated';
    const table: SyntheticAdItemUiTable = adItemUiTree(read);
    const template: SyntheticAdItemUiRow = table.rows[0]!;
    const stack: string[] = [];
    table.rows = levels.map((depth: number, index: number) => {
      const row: SyntheticAdItemUiRow = copyComplete(template);
      row.occurrenceId = 'mytreetable:ROW' + index;
      row.nativeRowId = nativeIds ? 'SYNTHETIC-UI-NODE-' + index : null;
      row.globalIndex = null;
      row.treeDepth = depth;
      stack.length = depth;
      stack[depth] = row.nativeRowId ?? 'ROW-' + index;
      row.treePath = [...stack];
      row.sourceLinks = [
        {
          targetRef: 'OR:wt.change2.WTChangeOrder2:' + (992001 + index),
          rawHref:
            '/infoPage?oid=OR:wt.change2.WTChangeOrder2:' + (992001 + index),
          numberRaw: 'SYNTHETIC-AD-' + index,
          nativeRole: 'RELATED',
          nativeColumnLabel: 'Number',
          nativeColumnToken: 'number',
          locator: table.panelLocator + ' synthetic-row-' + index + ' a.number',
        },
        ...copyComplete(template.sourceLinks),
      ];
      return row;
    });
    table.reportedTotal = table.rows.length;
    table.countEvidence.rawText = '(' + table.rows.length + ' objects)';
    table.windows[0]!.rowOccurrenceIds = table.rows.map(
      (row: SyntheticAdItemUiRow) => row.occurrenceId,
    );
    table.windows[0]!.globalIndices = [];
    table.windows[0]!.reportedTotal = table.rows.length;
    Object.assign(table.terminal, {
      total: table.rows.length,
      captured: table.rows.length,
      allGlobalIndices: false,
      allTreeNodesExpanded: false,
    });
  }
  return resealMetadata(env);
}

export function syntheticAdItemLegacyProjection(
  mode: 'TREE' | 'DOM_ROWS',
): TdmsDailyMetadataEnvelope {
  const env: TdmsDailyMetadataEnvelope = syntheticAdItem();
  for (const read of adItemUiProof(env).reads) {
    read.owner.stateRaw = 'Estimated';
    adItemUiTree(read).scanMode = mode;
  }
  return resealMetadata(env);
}
