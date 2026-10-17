import type { LcmMatrixQuery, LcmMatrixBinding, LcmMatrixResponse } from '@shared/lcm-matrix.interface';

function expansionScope(matrix: LcmMatrixResponse): string {
  return JSON.stringify([matrix.binding.readSetRef, matrix.binding.scopeRef,
    matrix.binding.permissionRevision, matrix.binding.projectionRevision]);
}

/** Compact URL state, tied to the authorized read set, avoids hundreds of repeated software names. */
export function readLcmExpansion(params: URLSearchParams, matrix: LcmMatrixResponse | null): Set<string> {
  if (!matrix) return new Set();
  if (params.has('lcmExpandedBits')) {
    const bits = params.get('lcmExpandedBits')!;
    if (params.get('lcmExpansionScope') !== expansionScope(matrix) ||
      bits.length > 16384 || !/^[a-f0-9]+$/u.test(bits)) return new Set();
    return new Set(matrix.softwareIndex.filter(group =>
      (parseInt(bits.charAt(Math.floor(group.sourceOrder / 4)) || '0', 16) & (1 << (group.sourceOrder % 4))) !== 0)
      .map(group => group.softwareRef));
  }
  const legacy = new Set(params.getAll('lcmExpanded'));
  return new Set(matrix.softwareIndex.filter(group => legacy.has(group.softwareRef)).map(group => group.softwareRef));
}

export function writeLcmExpansion(params: URLSearchParams, matrix: LcmMatrixResponse, expanded: Set<string>): URLSearchParams {
  const next = new URLSearchParams(params);
  const positions = matrix.softwareIndex.filter(group => expanded.has(group.softwareRef)).map(group => group.sourceOrder);
  const values: number[] = Array.from({ length: Math.ceil((Math.max(0, ...positions) + 1) / 4) }, () => 0);
  for (const position of positions) values[Math.floor(position / 4)] |= 1 << (position % 4);
  next.delete('lcmExpanded');
  next.set('lcmExpandedBits', values.map(value => value.toString(16)).join('').replace(/0+$/u, '') || '0');
  next.set('lcmExpansionScope', expansionScope(matrix));
  return next;
}

export function lcmQueryFromRoute(params: URLSearchParams): LcmMatrixQuery {
  const search = params.get('search') ?? params.get('softwareName') ?? params.get('partNumber');
  const models = [...new Set(params.getAll('aircraftModel').filter(Boolean))].sort();
  return { snapshotIds: params.getAll('lcmSnapshotId').sort(),
    ...(models.length === 1 ? { aircraftModel: models[0] } : models.length ? { aircraftModels: models } : {}),
    ...(params.has('aircraftRef') || params.has('emptyAircraftScope')
      ? { aircraftRefs: params.getAll('aircraftRef').sort() } : {}),
    ...(search ? { search } : {}), ...(params.get('ata') ? { ata: params.get('ata')! } : {}),
    differencesOnly: params.get('differencesOnly') === '1', anchorSoftwareRef: params.get('lcmAnchor') };
}

export function lcmBindingKey(binding: LcmMatrixBinding): string {
  return JSON.stringify([binding.readSetRef, binding.projectionRevision, binding.scopeRef,
    binding.permissionRevision, binding.filterHash, binding.orderRef]);
}

export function lcmMatrixFailure(error: unknown): string {
  const code = error && typeof error === 'object' && 'code' in error ? error.code
    : error instanceof Error ? error.message : '';
  if (code === 'LCM_SOURCE_READING_UNCONFIGURED' || code === 'LCM_MATRIX_READING_UNCONFIGURED')
    return '当前 Host 尚未配置 LCM 快照读取；请由来源负责人连接已获准的快照与读取授权。';
  if (code === 'LCM_MATRIX_DOMAIN_UNCONFIGURED')
    return 'LCM 管理域尚未由 Host 确认，暂不能聚合软件名称。';
  if (code === 'LCM_MATRIX_READ_INCOMPLETE')
    return '所选读取集未完整取得，构型统计待核实。';
  if (code === 'LCM_MATRIX_BINDING_CHANGED' || code === 'LCM_SOURCE_PERMISSION_CHANGED')
    return '来源范围或读取权限已变化，请重新读取所选快照。';
  const status = error && typeof error === 'object' && 'statusCode' in error ? Number(error.statusCode) : 0;
  if ([401, 403, 404].includes(status)) return '当前账户无法读取所选 LCM 范围，已清除构型内容。';
  return 'LCM 读取失败，请重试。所选快照保持不变。';
}

export function lcmMatrixAccessLost(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const status = 'statusCode' in error ? Number(error.statusCode) : 0;
  const code = 'code' in error ? error.code : error instanceof Error ? error.message : null;
  return [401, 403, 404].includes(status) || code === 'LCM_SOURCE_PERMISSION_CHANGED' || code === 'LCM_MATRIX_BINDING_CHANGED';
}
