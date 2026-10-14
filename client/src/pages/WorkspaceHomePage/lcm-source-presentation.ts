import type { LcmCandidateRecord } from '@shared/lcm-export-staging.interface';
import type { LcmSnapshotSummary } from '@shared/lcm-source-reading.interface';

export function lcmBooleanLabel(value: boolean | null): string {
  return value === true ? '是' : value === false ? '否' : '未知';
}

export function lcmRecordPresentation(record: LcmCandidateRecord) {
  return {
    softwareName: record.fields['软件名称'] || '软件名称未取得',
    system: record.fields['系统'] || '系统未取得',
    ata: record.fields['ATA章'] || record.fields['ATA章节'] || 'ATA 未取得',
    position: record.fields['FIN号'] || '位置 / 功能未取得',
    softwareVersion: record.fields['软件版本'] || record.fields['版本'] || '软件版本未取得',
    rawState: record.fields['状态'] || record.fields['矩阵值'] || '原始状态未取得',
    allowed: lcmBooleanLabel(record.allowed),
    installed: lcmBooleanLabel(record.installed),
    newlyEffective: '未知',
    effectiveAt: record.effectiveAt ?? '未知',
    executedAt: record.executedAt ?? '未知',
  };
}

export function lcmSnapshotTimeFacts(snapshot: LcmSnapshotSummary) {
  return [
    { label: '源数据截止日期', value: snapshot.sourceDataCutoffDate ?? '未取得' },
    { label: '来源观察时间', value: snapshot.sourceObservedAt ?? snapshot.sourceObservedDate ?? '未取得' },
    { label: '源导出时间', value: snapshot.sourceExportedAt ? `${snapshot.sourceExportedAt}（时区未核验）` : '未取得' },
    { label: 'Host 接收时间', value: snapshot.importedAt },
    { label: '构型实际生效时间', value: snapshot.sourceEffectiveAt ?? '未知' },
  ];
}
