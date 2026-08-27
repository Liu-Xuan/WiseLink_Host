import { ChevronDown, CircleGauge } from 'lucide-react';

import {
  type WlVisualMode,
  useWlTheme,
} from '@client/src/app/providers/ThemeProvider';
import {
  DropdownMenu,
  DropdownMenuContent,
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

export default function VisualModeControl({
  compact = false,
}: {
  compact?: boolean;
}) {
  const { visualMode, setVisualMode } = useWlTheme();
  const current = VISUAL_MODES.find((option) => option.value === visualMode)!;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={`wl-visual-mode-trigger${compact ? ' is-compact' : ''}`}
          aria-label={`视觉模式：${current.label}`}
          title={`视觉模式：${current.label}`}
        >
          <span className="wl-visual-mode-orb" aria-hidden="true">
            <CircleGauge />
          </span>
          <span className="wl-visual-mode-label">{current.label}</span>
          <ChevronDown className="wl-visual-mode-chevron" aria-hidden="true" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        sideOffset={8}
        className="wl-visual-mode-menu"
      >
        <DropdownMenuLabel>视觉完成度</DropdownMenuLabel>
        <p className="wl-visual-mode-hint">
          三种模式只改变材质与动效，不改变页面内容。
        </p>
        <DropdownMenuSeparator />
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
