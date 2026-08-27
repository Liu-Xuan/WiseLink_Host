import { useEffect, type ReactNode } from 'react';
import { ArrowUpRight, Search } from 'lucide-react';

import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from '@client/src/components/ui/command';

import './quick-open.css';

export interface QuickOpenItem {
  id: string;
  label: string;
  description?: string;
  keywords?: string;
  group: string;
  icon?: ReactNode;
  onSelect: () => void;
}

export default function QuickOpen({
  open,
  onOpenChange,
  items,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  items: QuickOpenItem[];
}) {
  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent): void => {
      if (
        event.key.toLowerCase() !== 'k' ||
        !(event.metaKey || event.ctrlKey)
      ) {
        return;
      }
      event.preventDefault();
      onOpenChange(!open);
    };
    document.addEventListener('keydown', handleShortcut);
    return () => document.removeEventListener('keydown', handleShortcut);
  }, [onOpenChange, open]);

  const groups = Array.from(new Set(items.map((item) => item.group)));

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title="快速打开"
      description="搜索当前资料、工作台视图和可执行操作"
      showCloseButton={false}
      className="wl-quick-open-dialog"
    >
      <div className="wl-quick-open-heading">
        <span>快速打开</span>
        <kbd>Esc</kbd>
      </div>
      <CommandInput placeholder="搜索当前资料或工作台操作" />
      <CommandList className="wl-quick-open-list">
        <CommandEmpty>当前范围内没有匹配内容</CommandEmpty>
        {groups.map((group) => (
          <CommandGroup key={group} heading={group}>
            {items
              .filter((item) => item.group === group)
              .map((item) => (
                <CommandItem
                  key={item.id}
                  value={`${item.label} ${item.description ?? ''} ${item.keywords ?? ''}`}
                  className="wl-quick-open-item"
                  onSelect={() => {
                    item.onSelect();
                    onOpenChange(false);
                  }}
                >
                  <span className="wl-quick-open-icon" aria-hidden="true">
                    {item.icon ?? <Search />}
                  </span>
                  <span className="wl-quick-open-copy">
                    <strong>{item.label}</strong>
                    {item.description ? (
                      <small>{item.description}</small>
                    ) : null}
                  </span>
                  <CommandShortcut>
                    <ArrowUpRight aria-hidden="true" />
                  </CommandShortcut>
                </CommandItem>
              ))}
          </CommandGroup>
        ))}
      </CommandList>
      <p className="wl-quick-open-footnote">
        仅显示当前账户可读取的数据和当前页面可执行的操作
      </p>
    </CommandDialog>
  );
}
