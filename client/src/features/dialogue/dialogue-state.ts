import type {
  DialogueMessageReadModel,
  DialogueThreadReadModel,
} from '@shared/dialogue.interface';

export function mergeDialogueRead(
  current: DialogueThreadReadModel | null,
  incoming: DialogueThreadReadModel,
): DialogueThreadReadModel {
  if (!current || current.threadRef !== incoming.threadRef) return incoming;
  if (incoming.revision < current.revision) return current;
  // Each response authorizes only its own page. Never retain another page's private text.
  return incoming;
}

export function dialogueNeedsRefresh(
  thread: DialogueThreadReadModel | null,
): boolean {
  return Boolean(
    thread?.messages.some(
      (message) =>
        message.purpose === 'CHAT' &&
        (!message.response ||
          ['STARTING', 'RUNNING'].includes(message.response.status)),
    ),
  );
}

export function selectedDialogueText(
  source: string,
  start: number,
  end: number,
): string | null {
  const splitsPair = (offset: number): boolean =>
    offset > 0 &&
    offset < source.length &&
    /[\uD800-\uDBFF]/u.test(source[offset - 1]) &&
    /[\uDC00-\uDFFF]/u.test(source[offset]);
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    start < 0 ||
    start >= end ||
    end > source.length ||
    splitsPair(start) ||
    splitsPair(end)
  )
    return null;
  return source.slice(start, end).trim() ? source.slice(start, end) : null;
}

/** Textarea normalizes CRLF to LF; server offsets still refer to the original string. */
export function dialogueSourceSelection(
  source: string,
  start: number,
  end: number,
) {
  const offsets: number[] = [0];
  for (let index = 0; index < source.length; index += 1) {
    if (source[index] === '\r' && source[index + 1] === '\n') index += 1;
    offsets.push(index + 1);
  }
  return { start: offsets[start] ?? -1, end: offsets[end] ?? -1 };
}

export function dialogueResponseLabel(
  message: DialogueMessageReadModel,
): string {
  if (message.purpose === 'CONTRIBUTION_ONLY')
    return 'Host 已保存片段 · 未调用 Aily · 尚未保存为贡献';
  if (!message.response) return 'Host 已保存 · Aily 回答尚未就绪';
  if (message.response.status === 'FAILED') return 'Aily 回答失败';
  if (message.response.status === 'UNKNOWN')
    return '已保存收到的内容，Aily 完成情况未确认；不会自动重新生成，刷新仅读取 Host 已存状态';
  if (message.response.incomplete) return 'Aily 回答不完整';
  return message.response.status === 'COMPLETED'
    ? 'Aily 解释 · 不等于工作判断或正式采用'
    : 'Aily 正在回答';
}

export function dialogueAilyError(error: string): string {
  return error.includes('AILY_')
    ? 'Aily 暂未完成本次回答。已收到的内容仍保留；稍后可查看已存状态，不会自动重新生成。'
    : error;
}
