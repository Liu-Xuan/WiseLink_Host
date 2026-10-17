import type { LcmCellValue } from './lcm-export-staging.interface';
import type {
  LcmNativeMatrix,
  LcmNativeMatrixResponse,
} from './lcm-native-matrix.interface';
import type {
  LcmMatrixAircraft,
  LcmMatrixPartCell,
  LcmMatrixQuery,
  LcmMatrixResponse,
  LcmMatrixSoftwareIndex,
  LcmMatrixSummaryCell,
  LcmMatrixWindowRequest,
} from './lcm-matrix.interface';
import {
  lcmAircraftRef,
  lcmNaturalCompare,
  lcmModelMatches,
  lcmQueryModels,
  lcmSoftwareMatches,
  lcmSoftwareRef,
} from './lcm-matrix-core';

export interface LcmNativeRowLocation {
  matrixIndex: number;
  rowIndex: number;
}
interface LcmNativeColumnLocation {
  matrixIndex: number;
  columnIndex: number;
}
export interface LcmNativeIndex {
  data: LcmNativeMatrixResponse;
  /** Two source-sized indices; no per-cell facts, provenance copies or empty-cell objects. */
  softwareRows: Map<string, LcmNativeRowLocation[]>;
  aircraftColumns: Map<string, LcmNativeColumnLocation[]>;
  software: LcmMatrixSoftwareIndex[];
  aircraft: LcmMatrixAircraft[];
}

export function lcmNativeText(value: LcmCellValue | undefined): string | null {
  if (value === null || value === undefined) return null;
  return String(value).trim() || null;
}

export function lcmNativeField(
  matrix: LcmNativeMatrix,
  rowIndex: number,
  name: string,
): string | null {
  return lcmNativeText(
    matrix.rows[rowIndex].fixed[
      matrix.fixedColumns.findIndex((column) => column.name === name)
    ],
  );
}

export function buildLcmNativeIndex(
  data: LcmNativeMatrixResponse,
): LcmNativeIndex {
  const softwareRows: LcmNativeIndex['softwareRows'] = new Map();
  const aircraftColumns: LcmNativeIndex['aircraftColumns'] = new Map();
  const software: Map<string, LcmMatrixSoftwareIndex> = new Map();
  const aircraft: Map<string, LcmMatrixAircraft> = new Map();
  data.matrices.forEach(
    (
      entry: LcmNativeMatrixResponse['matrices'][number],
      matrixIndex: number,
    ) => {
      const matrix: LcmNativeMatrix = entry.matrix;
      matrix.aircraft.forEach(
        (column: LcmNativeMatrix['aircraft'][number], columnIndex: number) => {
          const ref: string = lcmAircraftRef(
            entry.managementDomainRef,
            column.tailNumber,
          );
          const plane: LcmMatrixAircraft = aircraft.get(ref) ?? {
            aircraftRef: ref,
            managementDomainRef: entry.managementDomainRef,
            tailNumber: column.tailNumber,
            models: [],
          };
          if (!plane.models.includes(matrix.aircraftModel))
            plane.models.push(matrix.aircraftModel);
          aircraft.set(ref, plane);
          const positions: LcmNativeColumnLocation[] =
            aircraftColumns.get(ref) ?? [];
          positions.push({ matrixIndex, columnIndex });
          aircraftColumns.set(ref, positions);
        },
      );
      matrix.rows.forEach(
        (row: LcmNativeMatrix['rows'][number], rowIndex: number) => {
          if (
            row.fixed.every(
              (value: LcmCellValue) => lcmNativeText(value) === null,
            ) &&
            row.states.every(
              (value: LcmCellValue) => lcmNativeText(value) === null,
            )
          )
            return;
          const name: string | null = lcmNativeField(
            matrix,
            rowIndex,
            '软件名称',
          );
          const ref: string = lcmSoftwareRef(
            entry.managementDomainRef,
            name,
            JSON.stringify([entry.snapshotId, matrix.sheet, row.sourceRow]),
          );
          const group: LcmMatrixSoftwareIndex = software.get(ref) ?? {
            softwareRef: ref,
            managementDomainRef: entry.managementDomainRef,
            lcmSoftwareName: name,
            sourceOrder: software.size,
            ata: [],
            systems: [],
            parts: [],
            aliases: [],
            knownInstalledSetDifference: false,
          };
          const ata: string | null = lcmNativeField(matrix, rowIndex, 'ATA章');
          const system: string | null = lcmNativeField(
            matrix,
            rowIndex,
            '系统',
          );
          const part: string | null = lcmNativeField(
            matrix,
            rowIndex,
            '软件件号',
          );
          if (ata && !group.ata.includes(ata)) group.ata.push(ata);
          if (system && !group.systems.includes(system))
            group.systems.push(system);
          if (!group.parts.some((item) => item.partNumber === part))
            group.parts.push({
              partNumber: part,
              confirmedInstalledAircraftCount: 0,
              countCompleteness: 'PARTIAL',
              countScopeRef: data.binding.scopeRef,
            });
          const positions: LcmNativeRowLocation[] = softwareRows.get(ref) ?? [];
          positions.push({ matrixIndex, rowIndex });
          softwareRows.set(ref, positions);
          software.set(ref, group);
        },
      );
    },
  );
  for (const group of software.values())
    group.parts.sort((a, c) =>
      a.partNumber === null
        ? 1
        : c.partNumber === null
          ? -1
          : a.partNumber.localeCompare(c.partNumber),
    );
  return {
    data,
    softwareRows,
    aircraftColumns,
    software: [...software.values()].sort((a, b) =>
      a.lcmSoftwareName === null ? b.lcmSoftwareName === null ? a.sourceOrder - b.sourceOrder : 1
        : b.lcmSoftwareName === null ? -1 : lcmNaturalCompare(a.lcmSoftwareName, b.lcmSoftwareName) || a.sourceOrder - b.sourceOrder),
    aircraft: [...aircraft.values()].sort((a, c) =>
      lcmNaturalCompare(a.tailNumber, c.tailNumber),
    ),
  };
}

interface NativeState {
  installed: boolean | null;
  allowed: boolean | null;
  part: string | null;
  position: string;
}

function states(
  index: LcmNativeIndex,
  softwareRef: string,
  aircraftRef: string,
  aircraftModel?: string | readonly string[],
): NativeState[] {
  const values: NativeState[] = [];
  const columns: LcmNativeColumnLocation[] =
    index.aircraftColumns.get(aircraftRef) ?? [];
  for (const location of index.softwareRows.get(softwareRef) ?? []) {
    const entry = index.data.matrices[location.matrixIndex];
    if (!lcmModelMatches(entry.matrix.aircraftModel, aircraftModel)) continue;
    const column = columns.find(
      (item: LcmNativeColumnLocation) =>
        item.matrixIndex === location.matrixIndex,
    );
    if (!column) continue; // Outside this source rectangle: no observation, not a blank cell.
    const value: string | null = lcmNativeText(
      entry.matrix.rows[location.rowIndex].states[column.columnIndex],
    );
    const fin: string | null = lcmNativeField(
      entry.matrix,
      location.rowIndex,
      'FIN号',
    );
    values.push({
      part: lcmNativeField(entry.matrix, location.rowIndex, '软件件号'),
      position:
        fin === null
          ? JSON.stringify([entry.snapshotId, location.rowIndex])
          : 'FIN:' + fin,
      installed: value === '1' ? true : value === '2' ? false : null,
      allowed: value === '1' || value === '2' ? true : null,
    });
  }
  return values;
}

function conflicting(values: NativeState[]): Set<string | null> {
  const conflicts: Set<string | null> = new Set();
  const positions: Map<string, NativeState[]> = new Map();
  for (const value of values) {
    const list: NativeState[] = positions.get(value.position) ?? [];
    list.push(value);
    positions.set(value.position, list);
  }
  for (const located of positions.values()) {
    const installed: Set<string | null> = new Set(
      located
        .filter((value) => value.installed === true)
        .map((value) => value.part),
    );
    for (const value of located)
      if (
        installed.size > 1 ||
        (value.installed !== null &&
          located.some(
            (other) =>
              other.part === value.part &&
              other.installed !== null &&
              value.installed !== other.installed,
          ))
      )
        conflicts.add(value.part);
  }
  return conflicts;
}

function partState(
  values: NativeState[],
  aircraftRef: string,
  part: string | null,
  conflicts: Set<string | null>,
): LcmMatrixPartCell {
  const relevant: NativeState[] = values.filter((value) => value.part === part);
  if (!relevant.length)
    return { aircraftRef, state: 'NO_RECORD', installed: null, allowed: null };
  if (conflicts.has(part))
    return { aircraftRef, state: 'CONFLICT', installed: null, allowed: null };
  const installed: boolean = relevant.some((value) => value.installed === true);
  const unknown: boolean = relevant.some((value) => value.installed === null);
  const allowed: boolean | null = relevant.some(
    (value) => value.allowed === true,
  )
    ? true
    : null;
  return {
    aircraftRef,
    installed: installed ? true : unknown ? null : false,
    allowed,
    state: installed
      ? unknown
        ? 'PARTIAL_INSTALLED'
        : 'INSTALLED'
      : unknown
        ? 'UNKNOWN'
        : allowed
          ? 'ALLOWED_ONLY'
          : 'UNKNOWN',
  };
}

export function lcmNativePartCell(
  index: LcmNativeIndex,
  softwareRef: string,
  part: string | null,
  aircraftRef: string,
  model?: string | readonly string[],
): LcmMatrixPartCell {
  const values: NativeState[] = states(index, softwareRef, aircraftRef, model);
  return partState(values, aircraftRef, part, conflicting(values));
}

export function lcmNativeSummary(
  index: LcmNativeIndex,
  software: LcmMatrixSoftwareIndex,
  aircraftRef: string,
  model?: string | readonly string[],
): LcmMatrixSummaryCell {
  const values: NativeState[] = states(
    index,
    software.softwareRef,
    aircraftRef,
    model,
  );
  const conflicts: Set<string | null> = conflicting(values);
  const installedPartNumbers: string[] = software.parts.flatMap((part) =>
    part.partNumber !== null &&
    partState(values, aircraftRef, part.partNumber, conflicts).installed ===
      true
      ? [part.partNumber]
      : [],
  );
  return {
    aircraftRef,
    installedPartNumbers,
    qualification: conflicts.size
      ? 'CONFLICT'
      : !values.length
        ? 'NO_RECORD'
        : installedPartNumbers.length
          ? 'PARTIAL'
          : 'UNCONFIRMED',
  };
}

/** Only visible cells become UI objects. The retained model consists of source rows and two indices. */
export function lcmNativeWindow(
  index: LcmNativeIndex,
  request: LcmMatrixWindowRequest,
): LcmMatrixResponse {
  const query: LcmMatrixQuery = request.query;
  const models = lcmQueryModels(query);
  const aircraft: LcmMatrixAircraft[] = index.aircraft.filter(
    (plane) =>
      (!models.length || plane.models.some(model => models.includes(model))) &&
      (!query.aircraftRefs || query.aircraftRefs.includes(plane.aircraftRef)),
  );
  const selected: Set<string> = new Set(
    aircraft.map((plane) => plane.aircraftRef),
  );
  const visibleMatrices: Set<number> = new Set(
    index.data.matrices.flatMap((entry, matrixIndex: number) =>
      lcmModelMatches(entry.matrix.aircraftModel, models) &&
      entry.matrix.aircraft.some((plane) =>
        selected.has(
          lcmAircraftRef(entry.managementDomainRef, plane.tailNumber),
        ),
      )
        ? [matrixIndex]
        : [],
    ),
  );
  const software: LcmMatrixSoftwareIndex[] = index.software
    .filter((group) =>
      index.softwareRows
        .get(group.softwareRef)
        ?.some((location) => visibleMatrices.has(location.matrixIndex)),
    )
    .map((group) => {
      const parts = group.parts.filter((part) =>
        index.softwareRows
          .get(group.softwareRef)
          ?.some(
            (location) =>
              visibleMatrices.has(location.matrixIndex) &&
              lcmNativeField(
                index.data.matrices[location.matrixIndex].matrix,
                location.rowIndex,
                '软件件号',
              ) === part.partNumber,
          ),
      );
      const counts: Map<string | null, number> = new Map(
        parts.map((part) => [part.partNumber, 0]),
      );
      const installedSets: Set<string> = new Set();
      for (const plane of aircraft) {
        const values: NativeState[] = states(
          index,
          group.softwareRef,
          plane.aircraftRef,
          models,
        );
        const conflicts: Set<string | null> = conflicting(values);
        const installed: string[] = [];
        for (const part of parts)
          if (
            part.partNumber !== null &&
            partState(values, plane.aircraftRef, part.partNumber, conflicts)
              .installed === true
          ) {
            installed.push(part.partNumber);
            counts.set(part.partNumber, counts.get(part.partNumber)! + 1);
          }
        if (!conflicts.size && installed.length)
          installedSets.add(JSON.stringify(installed));
      }
      return {
        ...group,
        knownInstalledSetDifference: installedSets.size > 1,
        parts: parts.map((part) => ({
          ...part,
          confirmedInstalledAircraftCount: counts.get(part.partNumber)!,
        })),
      };
    })
    .filter((group) =>
      lcmSoftwareMatches(
        group,
        query.search ?? '',
        query.ata,
        query.differencesOnly,
      ),
    );
  const anchor: LcmMatrixSoftwareIndex | undefined = software.find(
    (group) => group.softwareRef === query.anchorSoftwareRef,
  );
  let order: string[] = aircraft.map((plane) => plane.aircraftRef);
  const orderGroups: LcmMatrixResponse['orderGroups'] = [];
  if (anchor) {
    const groups: Map<
      string,
      {
        parts: string[];
        ids: string[];
        kind: LcmMatrixResponse['orderGroups'][number]['kind'];
      }
    > = new Map();
    for (const plane of aircraft) {
      const summary: LcmMatrixSummaryCell = lcmNativeSummary(
        index,
        anchor,
        plane.aircraftRef,
        models,
      );
      const kind =
        summary.qualification === 'CONFLICT'
          ? 'CONFLICT_BUCKET'
          : summary.installedPartNumbers.length
            ? 'OBSERVED_INSTALLED_SET'
            : 'UNCONFIRMED_BUCKET';
      const key: string = JSON.stringify([kind, summary.installedPartNumbers]);
      const group = groups.get(key) ?? {
        parts: summary.installedPartNumbers,
        ids: [],
        kind,
      };
      group.ids.push(plane.aircraftRef);
      groups.set(key, group);
    }
    const ordered = [...groups.values()].sort(
      (a, c) =>
        (a.kind === 'OBSERVED_INSTALLED_SET'
          ? 0
          : a.kind === 'UNCONFIRMED_BUCKET'
            ? 1
            : 2) -
          (c.kind === 'OBSERVED_INSTALLED_SET'
            ? 0
            : c.kind === 'UNCONFIRMED_BUCKET'
              ? 1
              : 2) ||
        c.ids.length - a.ids.length ||
        JSON.stringify(a.parts).localeCompare(JSON.stringify(c.parts)),
    );
    order = ordered.flatMap((group) => group.ids);
    let start: number = 0;
    for (const group of ordered) {
      orderGroups.push({
        kind: group.kind,
        installedPartNumbers: group.parts,
        startIndex: start,
        endIndexExclusive: start + group.ids.length,
      });
      start += group.ids.length;
    }
  }
  const rowStart: number = request.rowStart ?? 0,
    columnStart: number = request.columnStart ?? 0;
  const columns: string[] = order.slice(
    columnStart,
    columnStart + (request.columnLimit ?? 16),
  );
  return {
    binding: index.data.binding,
    snapshots: index.data.snapshots,
    sourceMode: 'CANDIDATE',
    aircraftIndex: aircraft,
    aircraftOrder: order,
    softwareIndex: software,
    orderGroups,
    anchorSoftwareRef: anchor?.softwareRef ?? null,
    anchorCleared: Boolean(query.anchorSoftwareRef && !anchor),
    rowStart,
    columnStart,
    columns,
    softwareGroups: software
      .slice(rowStart, rowStart + (request.rowLimit ?? 20))
      .map((group) => ({
        softwareRef: group.softwareRef,
        summaryCells: columns.map((ref: string) =>
          lcmNativeSummary(index, group, ref, models),
        ),
        partRows: request.expandedSoftwareRefs?.includes(group.softwareRef)
          ? group.parts.map((part) => ({
              ...part,
              cells: columns.map((ref: string) =>
                lcmNativePartCell(
                  index,
                  group.softwareRef,
                  part.partNumber,
                  ref,
                  models,
                ),
              ),
            }))
          : [],
      })),
  };
}

export interface LcmNativeAircraftRow {
  key: string;
  snapshotId: string;
  softwareRef: string;
  lcmSoftwareName: string | null;
  partNumber: string | null;
  fin: string | null;
  installed: boolean | null;
  allowed: boolean | null;
  rawValue: LcmCellValue;
  sheet: string;
  sourceRow: number;
  sourceColumn: number;
}

/** Basic single-aircraft display reads only the selected source column from the loaded matrix. */
export function lcmNativeAircraftRows(
  index: LcmNativeIndex,
  query: LcmMatrixQuery,
  aircraftRef: string,
): LcmNativeAircraftRow[] {
  const projection: LcmMatrixResponse = lcmNativeWindow(index, {
    query,
    rowLimit: 0,
    columnLimit: 0,
  });
  if (!projection.aircraftOrder.includes(aircraftRef)) return [];
  const columns: LcmNativeColumnLocation[] =
    index.aircraftColumns.get(aircraftRef) ?? [];
  const rows: LcmNativeAircraftRow[] = [];
  const models = lcmQueryModels(query);
  for (const software of projection.softwareIndex) {
    for (const location of index.softwareRows.get(software.softwareRef) ?? []) {
      const entry = index.data.matrices[location.matrixIndex],
        matrix = entry.matrix;
      if (!lcmModelMatches(matrix.aircraftModel, models))
        continue;
      const column = columns.find(
        (value) => value.matrixIndex === location.matrixIndex,
      );
      if (!column) continue;
      const row = matrix.rows[location.rowIndex],
        plane = matrix.aircraft[column.columnIndex];
      const raw: LcmCellValue = row.states[column.columnIndex];
      const value: string | null = lcmNativeText(raw);
      rows.push({
        key: JSON.stringify([
          entry.snapshotId,
          matrix.sheet,
          row.sourceRow,
          plane.sourceColumn,
        ]),
        snapshotId: entry.snapshotId,
        softwareRef: software.softwareRef,
        lcmSoftwareName: software.lcmSoftwareName,
        partNumber: lcmNativeField(matrix, location.rowIndex, '软件件号'),
        fin: lcmNativeField(matrix, location.rowIndex, 'FIN号'),
        installed: value === '1' ? true : value === '2' ? false : null,
        allowed: value === '1' || value === '2' ? true : null,
        rawValue: raw,
        sheet: matrix.sheet,
        sourceRow: row.sourceRow,
        sourceColumn: plane.sourceColumn,
      });
    }
  }
  return rows;
}
