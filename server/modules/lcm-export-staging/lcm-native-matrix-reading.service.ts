import { lcmQueryModels, lcmModelMatches } from '@shared/lcm-matrix-core';
import { Inject, Injectable } from '@nestjs/common';
import type {
  LcmNativeMatrix,
  LcmNativeMatrixResponse,
} from '@shared/lcm-native-matrix.interface';
import type {
  LcmMatrixBinding,
  LcmMatrixDetailResponse,
} from '@shared/lcm-matrix.interface';
import type { LcmSnapshotSummary } from '@shared/lcm-source-reading.interface';
import {
  buildLcmNativeIndex,
  lcmNativeField,
  lcmNativeText,
  lcmNativeWindow,
} from '@shared/lcm-native-matrix-core';
import { lcmAircraftRef } from '@shared/lcm-matrix-core';
import { assertLcmNativeMatrix } from '@shared/lcm-native-matrix-validation';
import type { CanonicalMiaodaFinalUserActorContext as Actor } from '../work-item/canonical-object-access.port';
import { canonicalJson, sha256 } from './lcm-export.helpers';
import {
  lcmNativeCellRecord,
  lcmNativeCoordinateKey,
} from './lcm-native-matrix-records';
import {
  assertSnapshotGrant,
  LcmSourceReadingService,
} from './lcm-source-reading.service';
import {
  LCM_SNAPSHOT_READ_REPOSITORY,
  lcmReadingError,
  type LcmSnapshotReadRepository,
  type LcmSourceReadGrant,
} from './lcm-source-reading.port';
import {
  lcmMatrixBinding,
  lcmMatrixDetail,
  lcmMatrixQuery,
} from './lcm-matrix-query';

function inputIds(value: unknown): string[] {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).some((key: string) => key !== 'snapshotIds')
  )
    throw lcmReadingError('LCM_MATRIX_QUERY_INVALID', 400);
  return lcmMatrixQuery(value).snapshotIds;
}

function binding(
  snapshots: LcmSnapshotSummary[],
  grant: LcmSourceReadGrant,
): LcmMatrixBinding {
  return {
    readSetRef:
      'lcm-native-readset:' +
      sha256(
        canonicalJson(
          snapshots
            .slice()
            .sort((a, c) => a.snapshotId.localeCompare(c.snapshotId)),
        ),
      ),
    projectionRevision: 'wiselink.lcm.native_matrix.v1',
    scopeRef: 'lcm-native-scope:' + sha256(canonicalJson(grant)),
    permissionRevision: grant.permissionRevision,
    filterHash: 'native-local-filters',
    orderRef: 'native-local-aircraft-order',
  };
}

@Injectable()
export class LcmNativeMatrixReadingService {
  private readonly cache: Map<
    string,
    { expires: number; result: LcmNativeMatrixResponse }
  > = new Map();
  constructor(
    private readonly reading: LcmSourceReadingService,
    @Inject(LCM_SNAPSHOT_READ_REPOSITORY)
    private readonly repository: LcmSnapshotReadRepository,
  ) {}

  async authorize(
    actor: Actor,
    value: unknown,
  ): Promise<{ binding: LcmMatrixBinding }> {
    if (!value || typeof value !== 'object' || Array.isArray(value))
      throw lcmReadingError('LCM_MATRIX_QUERY_INVALID', 400);
    const input = value as Record<string, unknown>;
    if (
      Object.keys(input).some(
        (key: string) => !['snapshotIds', 'binding'].includes(key),
      )
    )
      throw lcmReadingError('LCM_MATRIX_QUERY_INVALID', 400);
    const ids: string[] = inputIds({ snapshotIds: input.snapshotIds });
    const expected: LcmMatrixBinding = lcmMatrixBinding(input.binding);
    const grant: LcmSourceReadGrant = await this.reading.authorize(actor);
    if (!this.repository.nativeMatrixReadSet)
      throw lcmReadingError('LCM_NATIVE_MATRIX_UNCONFIGURED', 503);
    const data = await this.repository.nativeMatrixReadSet(
      grant.scope,
      ids,
      true,
    );
    this.assertSnapshots(data.snapshots, ids, grant);
    const actual: LcmMatrixBinding = binding(data.snapshots, grant);
    if (canonicalJson(expected) !== canonicalJson(actual))
      throw lcmReadingError('LCM_MATRIX_BINDING_CHANGED', 409);
    await this.reading.reauthorize(actor, grant);
    return { binding: actual };
  }

  async read(actor: Actor, value: unknown): Promise<LcmNativeMatrixResponse> {
    const ids: string[] = inputIds(value);
    const grant: LcmSourceReadGrant = await this.reading.authorize(actor);
    const key: string = canonicalJson([actor.applicationScopeId, grant, ids]);
    const cached = this.cache.get(key);
    if (cached && cached.expires > Date.now()) {
      await this.reading.reauthorize(actor, grant);
      return cached.result;
    }
    if (!this.repository.nativeMatrixReadSet)
      throw lcmReadingError('LCM_NATIVE_MATRIX_UNCONFIGURED', 503);
    const data = await this.repository.nativeMatrixReadSet(grant.scope, ids);
    this.assertSnapshots(data.snapshots, ids, grant);
    const matrices: LcmNativeMatrixResponse['matrices'] = [];
    for (const snapshot of data.snapshots) {
      const matrix: LcmNativeMatrix | undefined = data.matrices.find(
        (entry) => entry.snapshotId === snapshot.snapshotId,
      )?.matrix;
      if (!matrix) throw lcmReadingError('LCM_NATIVE_MATRIX_BODY_MISSING', 409);
      assertLcmNativeMatrix(matrix);
      if (
        matrix.rawSha256 !== snapshot.originalSha256 ||
        !snapshot.coveredAircraftModels.includes(matrix.aircraftModel) ||
        matrix.schemaVersion !== 'wiselink.lcm.native_matrix.v1' ||
        matrix.rows.some(
          (row) =>
            row.fixed.length !== matrix!.fixedColumns.length ||
            row.states.length !== matrix!.aircraft.length,
        )
      )
        throw lcmReadingError('LCM_SNAPSHOT_BINDING_INVALID', 409);
      matrices.push({
        snapshotId: snapshot.snapshotId,
        managementDomainRef:
          grant.managementDomains![snapshot.sourceInstanceId]
            .managementDomainRef,
        matrix,
      });
    }
    if (
      matrices.reduce(
        (total: number, entry) =>
          total + entry.matrix.rows.length * entry.matrix.aircraft.length,
        0,
      ) > 500000
    )
      throw lcmReadingError('LCM_MATRIX_SCOPE_TOO_LARGE', 413);
    const result: LcmNativeMatrixResponse = {
      binding: binding(data.snapshots, grant),
      snapshots: data.snapshots,
      matrices,
    };
    await this.reading.reauthorize(actor, grant);
    while (this.cache.size >= 2)
      this.cache.delete(this.cache.keys().next().value!);
    this.cache.set(key, { expires: Date.now() + 30000, result });
    return result;
  }

  async details(
    actor: Actor,
    value: unknown,
  ): Promise<LcmMatrixDetailResponse> {
    const request = lcmMatrixDetail(value);
    const data: LcmNativeMatrixResponse = await this.read(actor, {
      snapshotIds: request.query.snapshotIds,
    });
    if (canonicalJson(data.binding) !== canonicalJson(request.binding))
      throw lcmReadingError('LCM_MATRIX_BINDING_CHANGED', 409);
    const index = buildLcmNativeIndex(data);
    const selectedIndex = request.softwareRef
      ? {
          ...index,
          software: index.software.filter(
            (software) => software.softwareRef === request.softwareRef,
          ),
        }
      : index;
    const projection = lcmNativeWindow(selectedIndex, {
      query: request.query,
      rowLimit: 0,
      columnLimit: 0,
    });
    if (
      request.softwareRef &&
      !projection.softwareIndex.some(
        (group) => group.softwareRef === request.softwareRef,
      )
    )
      throw lcmReadingError('LCM_MATRIX_SOFTWARE_NOT_FOUND', 404);
    if (
      request.aircraftRef &&
      !projection.aircraftOrder.includes(request.aircraftRef)
    )
      throw lcmReadingError('LCM_MATRIX_AIRCRAFT_NOT_FOUND', 404);
    interface SourceGroup {
      key: string;
      softwareRef: string;
      aircraftRef: string;
      name: string | null;
      part: string | null;
      fin: string | null;
      order: number;
      matrixIndex: number;
      coordinates: Array<{ row: number; column: number }>;
    }
    const selectedPlanes: Set<string> = new Set(projection.aircraftOrder);
    const models = lcmQueryModels(request.query);
    const groups: Map<string, SourceGroup> = new Map();
    projection.softwareIndex.forEach((software, order: number) => {
      if (request.softwareRef && request.softwareRef !== software.softwareRef)
        return;
      for (const location of index.softwareRows.get(software.softwareRef) ??
        []) {
        const entry = data.matrices[location.matrixIndex],
          matrix = entry.matrix;
        if (!lcmModelMatches(matrix.aircraftModel, models))
          continue;
        const part: string | null = lcmNativeField(
          matrix,
          location.rowIndex,
          '软件件号',
        );
        if (request.partNumber !== undefined && request.partNumber !== part)
          continue;
        const columns: number[] = request.aircraftRef
          ? (index.aircraftColumns.get(request.aircraftRef) ?? [])
              .filter((column) => column.matrixIndex === location.matrixIndex)
              .map((column) => column.columnIndex)
          : matrix.aircraft.map((_column, columnIndex: number) => columnIndex);
        columns.forEach((columnIndex: number) => {
          const column = matrix.aircraft[columnIndex];
          const ref: string = lcmAircraftRef(
            entry.managementDomainRef,
            column.tailNumber,
          );
          if (
            !selectedPlanes.has(ref) ||
            (request.aircraftRef && request.aircraftRef !== ref)
          )
            return;
          const row = matrix.rows[location.rowIndex];
          const identity: string = canonicalJson([
            entry.snapshotId,
            column.tailNumber,
            row.fixed.map(lcmNativeText),
            lcmNativeText(row.states[columnIndex]),
          ]);
          const group: SourceGroup = groups.get(identity) ?? {
            key: lcmNativeCoordinateKey(
              entry.snapshotId,
              matrix,
              location.rowIndex,
              columnIndex,
            ),
            softwareRef: software.softwareRef,
            aircraftRef: ref,
            name: software.lcmSoftwareName,
            part,
            fin: lcmNativeField(matrix, location.rowIndex, 'FIN号'),
            order,
            matrixIndex: location.matrixIndex,
            coordinates: [],
          };
          group.coordinates.push({
            row: location.rowIndex,
            column: columnIndex,
          });
          groups.set(identity, group);
        });
      }
    });
    const ordered: SourceGroup[] = [...groups.values()].sort(
      (a, c) =>
        a.order - c.order ||
        (a.part ?? '').localeCompare(c.part ?? '') ||
        (a.fin ?? '').localeCompare(c.fin ?? '') ||
        a.key.localeCompare(c.key),
    );
    const offset: number = request.after
      ? ordered.findIndex((group) => group.key === request.after) + 1
      : 0;
    if (request.after && offset === 0)
      throw lcmReadingError('LCM_CURSOR_INVALID', 400);
    const page: SourceGroup[] = ordered.slice(offset, offset + 200);
    const records: LcmMatrixDetailResponse['records'] = page.map((group) => {
      const entry = data.matrices[group.matrixIndex],
        first = group.coordinates[0];
      const record = lcmNativeCellRecord(entry.matrix, first.row, first.column);
      for (const coordinate of group.coordinates.slice(1))
        record.sourceRows.push(
          ...lcmNativeCellRecord(
            entry.matrix,
            coordinate.row,
            coordinate.column,
          ).sourceRows,
        );
      return {
        snapshot: data.snapshots.find(
          (snapshot) => snapshot.snapshotId === entry.snapshotId,
        )!,
        softwareRef: group.softwareRef,
        aircraftRef: group.aircraftRef,
        lcmSoftwareName: group.name,
        record,
      };
    });
    // Also checks current permission after source rows have been assembled.
    await this.authorize(actor, {
      snapshotIds: request.query.snapshotIds,
      binding: data.binding,
    });
    return {
      binding: data.binding,
      records,
      nextAfter:
        offset + page.length < ordered.length
          ? page[page.length - 1].key
          : null,
      originalUnavailableReason: data.snapshots.every(
        (snapshot) => snapshot.originalAvailability === 'HOST_FILE_SERVICE',
      )
        ? null
        : 'LOCAL_REFERENCE_ONLY',
    };
  }

  private assertSnapshots(
    snapshots: LcmSnapshotSummary[],
    ids: string[],
    grant: LcmSourceReadGrant,
  ): void {
    if (
      snapshots.length !== ids.length ||
      new Set(snapshots.map((snapshot) => snapshot.snapshotId)).size !==
        ids.length ||
      snapshots.some((snapshot) => !ids.includes(snapshot.snapshotId))
    )
      throw lcmReadingError('LCM_MATRIX_READ_SET_INVALID', 409);
    for (const snapshot of snapshots) {
      assertSnapshotGrant(snapshot, grant);
      const domain = grant.managementDomains?.[snapshot.sourceInstanceId];
      if (!domain?.managementDomainRef?.trim() || !domain.evidenceRef?.trim())
        throw lcmReadingError('LCM_MATRIX_DOMAIN_UNCONFIGURED', 503);
    }
  }
}
