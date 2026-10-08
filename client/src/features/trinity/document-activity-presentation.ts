import {
  documentActivityStatementTimes,
  isDocumentActivityStatementV2,
  type AnyDocumentActivityStatement as DocumentActivityStatement,
} from '@shared/document-activity.interface';

/** Raw display only: no new calendar, business meaning or source summary. */
export function activityStatementTimeText(statement: DocumentActivityStatement, empty = '时间未提取'): string {
  const times = documentActivityStatementTimes(statement);
  if (!times.length) return isDocumentActivityStatementV2(statement) ? '时间：本候选未捕获' : empty;
  return times.map((time) => isDocumentActivityStatementV2(statement)
    ? `${time.raw}（${time.role} · ${time.precision} · ${time.expression}）`
    : time.raw).join('；');
}
