import type { LcmCandidateRecord, LcmCellValue } from '@shared/lcm-export-staging.interface';
import type { LcmSnapshotSummary } from '@shared/lcm-source-reading.interface';
import { lcmNaturalCompare } from '@shared/lcm-matrix-core';

/** A UI alias only. Source/model keys and original filenames stay untouched. */
export const lcmModelLabel = (model: string): string => /^ARJ21(?:[-\s].+)?$/iu.test(model.trim()) ? 'C909' : model;

export function lcmModelChoices(models: readonly string[]): Array<{ value: string; label: string }> {
  const values = [...new Set(models)];
  const rank = (value: string): number => {
    const position = 'BAC'.indexOf(lcmModelLabel(value).charAt(0).toUpperCase());
    return position < 0 ? 3 : position;
  };
  return values.sort((a, b) => rank(a) - rank(b) || (rank(a) === 3 ? 0 : lcmNaturalCompare(lcmModelLabel(a), lcmModelLabel(b))))
    .map(value => ({ value, label: lcmModelLabel(value) + (lcmModelLabel(value) !== value &&
      values.some(other => other !== value && lcmModelLabel(other) === lcmModelLabel(value)) ? `（原 ${value}）` : '') }));
}

export const lcmModelNames = (models: readonly string[]): string => lcmModelChoices(models).map(choice => choice.label).join(' / ');

/** Call only for an existing source cell; undefined means it was not collected. */
export const lcmRawBlank = (value: LcmCellValue | undefined): boolean =>
  value === null || (typeof value === 'string' && value.trim() === '');

export const lcmRawStateLabel = (value: LcmCellValue): string => lcmRawBlank(value) ? '无' : String(value);

function recordHasBlankMatrixCell(record: LcmCandidateRecord): boolean {
  return record.semanticBasis === 'user-confirmed-matrix-definition' && record.sourceRows.length > 0 &&
    record.sourceRows.every(row => Boolean(row.cells['矩阵值']) && lcmRawBlank(row.cells['矩阵值'].rawValue));
}

/** Display-only parser; compact dates use fixed YYYY/MM and one or two day digits. */
export function lcmFilenameStateDate(filename: string): string | null {
  const compact = filename.match(/_(\d{4})(\d{2})(\d{1,2})(?:(\d{2})(\d{2})(\d{2}))?\.xlsx?$/iu);
  const separated = filename.match(/(?:^|_)(\d{4})[-.](\d{2})[-.](\d{2})(?:[_T -](\d{2})[-.:]?(\d{2})[-.:]?(\d{2}))?\.xlsx?$/iu);
  const match = compact ?? separated;
  if (!match) return null;
  const day = `${match[1]}-${match[2]}-${match[3].padStart(2, '0')}`;
  const parsed = new Date(day + 'T00:00:00Z');
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== day ||
    (match[4] !== undefined && (Number(match[4]) > 23 || Number(match[5]) > 59 || Number(match[6]) > 59))) return null;
  return day;
}

export function lcmSnapshotStateDate(snapshot: LcmSnapshotSummary): string | null {
  return lcmFilenameStateDate(snapshot.originalFileName);
}

export function lcmBooleanLabel(value: boolean | null): string {
  return value === true ? '是' : value === false ? '否' : '未知';
}

export function lcmRecordPresentation(record: LcmCandidateRecord) {
  const blank = recordHasBlankMatrixCell(record);
  return {
    softwareName: record.fields['软件名称'] || '软件名称未取得',
    system: record.fields['系统'] || '系统未取得',
    ata: record.fields['ATA章'] || record.fields['ATA章节'] || 'ATA 未取得',
    position: record.fields['FIN号'] || '位置 / 功能未取得',
    softwareVersion: record.fields['软件版本'] || record.fields['版本'] || '软件版本未取得',
    rawState: blank ? '无' : record.fields['状态'] || record.fields['矩阵值'] || '原始状态未取得',
    allowed: blank ? '无' : lcmBooleanLabel(record.allowed),
    installed: blank ? '无' : lcmBooleanLabel(record.installed),
    newlyEffective: '未知',
    effectiveAt: record.effectiveAt ?? '未知',
    executedAt: record.executedAt ?? '未知',
  };
}

export function lcmSnapshotTimeFacts(snapshot: LcmSnapshotSummary) {
  return [
    { label: '快照状态日', value: lcmSnapshotStateDate(snapshot) ?? '未识别' },
    { label: '源数据截止日期', value: snapshot.sourceDataCutoffDate ?? '未取得' },
    { label: '来源观察时间', value: snapshot.sourceObservedAt ?? snapshot.sourceObservedDate ?? '未取得' },
    { label: '源导出时间', value: snapshot.sourceExportedAt ? `${snapshot.sourceExportedAt}（时区未核验）` : '未取得' },
    { label: 'Host 接收时间', value: snapshot.importedAt },
    { label: '构型实际生效时间', value: snapshot.sourceEffectiveAt ?? '未知' },
  ];
}
