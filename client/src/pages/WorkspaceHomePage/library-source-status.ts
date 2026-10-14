import type { CanonicalLibraryDocumentVersionSummary } from '@shared/api.interface';

export function librarySourceStatus(version: CanonicalLibraryDocumentVersionSummary) {
  return {
    received: '正式版本已登记',
    original: '原件可用性待核',
    opinions: 'TDMS 意见待读取',
    parsing: version.parsing?.status === 'PUBLISHED' ? '已解析'
      : version.parsing?.status === 'FAILED' ? '解析失败'
        : version.parsing ? '解析处理中' : '尚无解析记录',
    assessment: version.workItemCount ? `已有 ${version.workItemCount} 个评估任务，完成情况待核` : '尚无系统评估任务',
    sourceModified: '来源更新时间未取得',
    synchronized: '最近同步时间未取得',
  };
}
