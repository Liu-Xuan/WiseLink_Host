import type { DialogueThreadReadModel } from '@shared/dialogue.interface';
import type { DialogueWorkItemOption } from './DialogueContributionPicker';

export interface DialogueFocusState {
  ids: string[];
  initialized: boolean;
}

export function restoreDialogueFocus(
  state: DialogueFocusState,
  savedIds: string[],
): DialogueFocusState {
  return state.initialized
    ? state
    : { ids: [...new Set(savedIds)].slice(0, 8), initialized: true };
}

/** Keep selected IDs, but derive labels only from the current authorized page/options. */
export function dialogueFocusOptions(
  ids: string[],
  options: DialogueWorkItemOption[],
  thread: DialogueThreadReadModel | null,
): DialogueWorkItemOption[] {
  const available = new Map(options.map((item) => [item.workItemId, item]));
  ids.forEach((id) => {
    if (available.has(id)) return;
    const current = thread?.messages
      .flatMap((message) => message.focus)
      .find((context) => context.workItemId === id);
    available.set(id, {
      workItemId: id,
      label: current?.documentLabel || '已选资料（名称暂不可用，可移除）',
      documentVersionId: current?.documentVersionId,
    });
  });
  return [...available.values()];
}

/** Group only the same exact document version; labels alone cannot prove identity. */
export function groupDialogueWorkItems(
  options: DialogueWorkItemOption[],
): DialogueWorkItemOption[][] {
  const groups: Map<string, DialogueWorkItemOption[]> = new Map();
  for (const item of options) {
    const key: string = item.documentVersionId || item.workItemId;
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  return [...groups.values()].map((items: DialogueWorkItemOption[]) =>
    items.sort((left: DialogueWorkItemOption, right: DialogueWorkItemOption) =>
      (right.createdAt ?? '').localeCompare(left.createdAt ?? ''),
    ),
  );
}
