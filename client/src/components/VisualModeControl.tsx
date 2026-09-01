import { ChevronDown, Contrast, Layers3, Moon, Sun } from 'lucide-react';

import {
  type WlVisualMode,
  useWlTheme,
} from '@client/src/app/providers/ThemeProvider';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@client/src/components/ui/dropdown-menu';

import './visual-mode-control.css';

const VISUAL_MODES: ReadonlyArray<{
  value: WlVisualMode;
  label: string;
  description: string;
}> = [
  {
    value: 'default',
    label: '默认效果',
    description: '平衡材质深度与日常性能',
  },
  {
    value: 'ultra',
    label: '极致效果',
    description: '更精细的边缘、光影与景深',
  },
  {
    value: 'compatible',
    label: '兼容效果',
    description: '实体材质，适合远程桌面与旧设备',
  },
];

function isVisualMode(value: string): value is WlVisualMode {
  return VISUAL_MODES.some((option) => option.value === value);
}

function shortModeLabel(label: string): string {
  return label.replace('效果', '');
}

export default function VisualModeControl({
  compact = false,
}: {
  compact?: boolean;
}) {
  const {
    theme,
    visualMode,
    reduceTransparency,
    setVisualMode,
    toggleTheme,
    toggleTransparency,
  } = useWlTheme();
  const current = VISUAL_MODES.find((option) => option.value === visualMode)!;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={`wl-visual-mode-trigger${compact ? ' is-compact' : ''}`}
          aria-label={`显示与视觉设置：${current.label}`}
          title={`显示与视觉设置：${current.label}`}
        >
          <span className="wl-visual-mode-orb" aria-hidden="true">
            <Layers3 />
          </span>
          <span className="wl-visual-mode-label">
            视觉效果 · {shortModeLabel(current.label)}
          </span>
          <ChevronDown className="wl-visual-mode-chevron" aria-hidden="true" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align={compact ? 'start' : 'end'}
        side={compact ? 'right' : 'bottom'}
        sideOffset={8}
        className="wl-visual-mode-menu"
      >
        <DropdownMenuLabel>显示与视觉设置</DropdownMenuLabel>
        <p className="wl-visual-mode-hint">
          三种效果只改变材质与动效，不改变工程内容和操作。
        </p>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={toggleTheme}>
          {theme === 'dark' ? (
            <Sun aria-hidden="true" />
          ) : (
            <Moon aria-hidden="true" />
          )}
          <span>{theme === 'dark' ? '切换浅色主题' : '切换深色主题'}</span>
        </DropdownMenuItem>
        <DropdownMenuCheckboxItem
          checked={reduceTransparency}
          onCheckedChange={toggleTransparency}
        >
          <Contrast aria-hidden="true" />
          <span>降低透明度</span>
        </DropdownMenuCheckboxItem>
        <DropdownMenuSeparator />
        <DropdownMenuLabel>视觉效果</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={visualMode}
          onValueChange={(value) => {
            if (isVisualMode(value)) setVisualMode(value);
          }}
        >
          {VISUAL_MODES.map((option) => (
            <DropdownMenuRadioItem
              key={option.value}
              value={option.value}
              className="wl-visual-mode-option"
            >
              <span>
                <strong>{option.label}</strong>
                <small>{option.description}</small>
              </span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
