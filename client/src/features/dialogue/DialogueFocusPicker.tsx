import { useState, type FC } from 'react';
import { Button } from '@client/src/components/ui/button';
import { Input } from '@client/src/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@client/src/components/ui/dialog';
import type { DialogueWorkItemOption } from './DialogueContributionPicker';
import { groupDialogueWorkItems } from './dialogue-focus';

export interface DialogueWorkItemSearch {
  value: string;
  onChange(value: string): void;
  loading: boolean;
  error?: string;
  hasMore: boolean;
  loadMore(): void;
}

interface DialogueFocusPickerProps {
  ids: string[];
  options: DialogueWorkItemOption[];
  search?: DialogueWorkItemSearch;
  disabled: boolean;
  onChange(ids: string[]): void;
}

export const DialogueFocusPicker: FC<DialogueFocusPickerProps> = ({
  ids,
  options,
  search,
  disabled,
  onChange,
}) => {
  const [open, setOpen] = useState(false);
  const [localSearch, setLocalSearch] = useState('');
  const selected: DialogueWorkItemOption[] = options.filter(
    (item: DialogueWorkItemOption) => ids.includes(item.workItemId),
  );
  const matches: DialogueWorkItemOption[] = search
    ? options
    : options.filter((item: DialogueWorkItemOption) =>
        item.label.toLowerCase().includes(localSearch.toLowerCase()),
      );
  const groups: DialogueWorkItemOption[][] = groupDialogueWorkItems(matches);
  const toggle = (id: string): void =>
    onChange(
      ids.includes(id)
        ? ids.filter((selectedId: string) => selectedId !== id)
        : [...ids, id],
    );
  const choice = (item: DialogueWorkItemOption, history = false) => (
    <Button
      key={item.workItemId}
      variant={ids.includes(item.workItemId) ? 'secondary' : 'ghost'}
      className="h-auto w-full justify-start whitespace-normal text-left"
      aria-pressed={ids.includes(item.workItemId)}
      disabled={disabled || (!ids.includes(item.workItemId) && ids.length >= 8)}
      onClick={() => toggle(item.workItemId)}
    >
      <span className="grid gap-1 py-1">
        <span>
          {ids.includes(item.workItemId) ? '已选 · ' : ''}
          {history ? '评估记录' : item.label}
        </span>
        {item.description && (
          <span className="text-xs font-normal text-muted-foreground">
            {item.description}
          </span>
        )}
      </span>
    </Button>
  );
  return (
    <div className="rounded-md bg-muted/40 px-3 py-2" aria-label="当前讨论资料">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0 space-y-1 text-sm">
          <p className="text-xs text-muted-foreground">
            {ids.length ? '围绕以下资料讨论' : '自由讨论 · 未关联资料'}
          </p>
          {selected.map((item: DialogueWorkItemOption) => (
            <p key={item.workItemId} className="break-words font-medium">
              {item.label}
            </p>
          ))}
        </div>
        <Button
          variant="ghost"
          size="sm"
          disabled={disabled}
          onClick={() => setOpen(true)}
        >
          {ids.length ? '更换或补充资料' : '关联资料'}
        </Button>
      </div>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[85dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>选择讨论资料</DialogTitle>
            <DialogDescription>
              从当前资料继续即可；需要时可补充其他资料，最多八份。同一资料的历史评估已收起。
            </DialogDescription>
          </DialogHeader>
          <Input
            aria-label="搜索讨论资料"
            placeholder="搜索资料编号或名称"
            value={search?.value ?? localSearch}
            onChange={(event) =>
              search
                ? search.onChange(event.target.value)
                : setLocalSearch(event.target.value)
            }
          />
          {search?.error && (
            <p role="alert" className="text-sm text-destructive">
              {search.error}
            </p>
          )}
          {search?.loading && (
            <p role="status" className="text-sm">
              正在查找资料…
            </p>
          )}
          <div className="space-y-2" aria-label="可关联资料">
            {groups.map((items: DialogueWorkItemOption[]) => {
              const primary: DialogueWorkItemOption =
                items.find((item: DialogueWorkItemOption) =>
                  ids.includes(item.workItemId),
                ) ?? items[0];
              return (
                <div
                  key={primary.documentVersionId ?? primary.workItemId}
                  className="rounded-md border p-1"
                >
                  {choice(primary)}
                  {items.length > 1 && (
                    <details className="px-3 pb-1 text-xs text-muted-foreground">
                      <summary>其他评估记录（{items.length - 1}）</summary>
                      {items
                        .filter(
                          (item: DialogueWorkItemOption) => item !== primary,
                        )
                        .map((item: DialogueWorkItemOption) =>
                          choice(item, true),
                        )}
                    </details>
                  )}
                </div>
              );
            })}
            {!groups.length && !search?.loading && (
              <p className="py-4 text-center text-sm text-muted-foreground">
                未找到资料，请更换关键词。
              </p>
            )}
          </div>
          {search?.hasMore && (
            <Button
              variant="ghost"
              disabled={search.loading}
              onClick={search.loadMore}
            >
              查看更多资料
            </Button>
          )}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-sm text-muted-foreground">
              已关联 {ids.length} 份
            </span>
            <Button onClick={() => setOpen(false)}>完成</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};
