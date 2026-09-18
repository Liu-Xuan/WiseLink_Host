// Perspective Switcher component
import React from 'react';
import type { PerspectiveType } from '../types';

interface PerspectiveSwitcherProps {
  current: PerspectiveType;
  onChange: (perspective: PerspectiveType) => void;
}

const PERSPECTIVES = [
  { id: 'document' as const, label: '文档视角', icon: '📄' },
  { id: 'knowledge' as const, label: '知识视角', icon: '🧠' },
  { id: 'timeline' as const, label: '时间视角', icon: '⏱️' },
  { id: 'people' as const, label: '人员视角', icon: '👥' }
];

export function PerspectiveSwitcher({ current, onChange }: PerspectiveSwitcherProps) {
  return (
    <div className="perspective-switcher">
      {PERSPECTIVES.map(({ id, label, icon }) => (
        <button
          key={id}
          className={`perspective-btn ${current === id ? 'active' : ''}`}
          onClick={() => onChange(id)}
          title={label}
        >
          <span className="perspective-icon">{icon}</span>
          <span className="perspective-label">{label}</span>
        </button>
      ))}
    </div>
  );
}
