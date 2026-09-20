/**
 * Icon - 统一图标组件
 *
 * 基于 Suite 1.1 设计的图标系统
 * 支持常用图标的显示
 */

import React from 'react';

export type IconName =
  | 'file'
  | 'book'
  | 'graph'
  | 'activity'
  | 'list'
  | 'settings'
  | 'help'
  | 'clock'
  | 'work'
  | 'discussion'
  | 'search'
  | 'chevron'
  | 'down'
  | 'topic'
  | 'fit'
  | 'play'
  | 'pause'
  | 'bulb'
  | 'layers'
  | 'chapter'
  | 'reset'
  | 'plus';

interface IconProps {
  name: IconName;
  size?: number;
  className?: string;
}

/**
 * 简化的 SVG 图标组件
 * 生产环境应该替换为完整的图标库
 */
export function Icon({ name, size = 20, className = '' }: IconProps) {
  const icons: Record<IconName, string> = {
    file: 'M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z M13 2v7h7',
    book: 'M4 19.5A2.5 2.5 0 0 1 6.5 17H20 M4 19.5A2.5 2.5 0 0 0 6.5 22H20V2H6.5A2.5 2.5 0 0 0 4 4.5z',
    graph: 'M22 12h-4l-3 9L9 3l-3 9H2',
    activity: 'M22 12h-4l-3 9L9 3l-3 9H2',
    list: 'M8 6h13 M8 12h13 M8 18h13 M3 6h.01 M3 12h.01 M3 18h.01',
    settings: 'M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z M12 12m-3 0a3 3 0 1 0 6 0a3 3 0 1 0-6 0',
    help: 'M12 12m-10 0a10 10 0 1 0 20 0a10 10 0 1 0-20 0 M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3 M12 17h.01',
    clock: 'M12 12m-9 0a9 9 0 1 0 18 0a9 9 0 1 0-18 0 M12 7v5l4 2',
    work: 'M12 12m-9 0a9 9 0 1 0 18 0a9 9 0 1 0-18 0 M12 7v5h5',
    discussion: 'M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z',
    search: 'M11 11m-8 0a8 8 0 1 0 16 0a8 8 0 1 0-16 0 M21 21l-4.35-4.35',
    chevron: 'M9 18l6-6-6-6',
    down: 'M6 9l6 6 6-6',
    topic: 'M12 12m-2 0a2 2 0 1 0 4 0a2 2 0 1 0-4 0',
    fit: 'M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3',
    play: 'M5 3l14 9-14 9V3',
    pause: 'M6 4h4v16H6zm8 0h4v16h-4z',
    bulb: 'M9 18h6 M10 22h4 M15 8a5 5 0 1 1-6 4.9V14',
    layers: 'M12 2L2 7l10 5 10-5-10-5z M2 17l10 5 10-5 M2 12l10 5 10-5',
    chapter: 'M4 19.5A2.5 2.5 0 0 1 6.5 17H20',
    reset: 'M1 4v6h6 M23 20v-6h-6 M20.49 9A9 9 0 0 0 5.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 0 1 3.51 15',
    plus: 'M12 5v14m-7-7h14',
  };

  const path = icons[name] || '';

  return (
    <svg
      className={`icon icon-${name} ${className}`}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {path.split(' M ').map((subPath, i) => (
        <path key={i} d={i === 0 ? subPath : `M ${subPath}`} />
      ))}
    </svg>
  );
}
