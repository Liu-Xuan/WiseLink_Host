/**
 * SettingsModal - 设置弹窗
 *
 * 提供主题、效果、动效的设置
 */

import React from 'react';

interface SettingsModalProps {
  theme: 'light' | 'dark';
  effects: 'default' | 'ultra' | 'compatible';
  motion: boolean;
  onChangeTheme: (theme: 'light' | 'dark') => void;
  onChangeEffects: (effects: 'default' | 'ultra' | 'compatible') => void;
  onToggleMotion: () => void;
  onClose: () => void;
}

export function SettingsModal({
  theme,
  effects,
  motion,
  onChangeTheme,
  onChangeEffects,
  onToggleMotion,
  onClose,
}: SettingsModalProps) {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>显示与效果</h2>
          <button className="modal-close" onClick={onClose} aria-label="关闭">
            ×
          </button>
        </div>

        <div className="modal-body">
          {/* 主题选择 */}
          <section>
            <h3>页面主题</h3>
            <div className="tabs">
              <button
                className={theme === 'light' ? 'active' : ''}
                onClick={() => onChangeTheme('light')}
              >
                浅色 · Silver
              </button>
              <button
                className={theme === 'dark' ? 'active' : ''}
                onClick={() => onChangeTheme('dark')}
              >
                深色 · Carbon
              </button>
            </div>
          </section>

          {/* 效果档位 */}
          <section>
            <h3>视觉效果</h3>
            <div className="tabs">
              <button
                className={effects === 'default' ? 'active' : ''}
                onClick={() => onChangeEffects('default')}
              >
                默认
              </button>
              <button
                className={effects === 'ultra' ? 'active' : ''}
                onClick={() => onChangeEffects('ultra')}
              >
                最高
              </button>
              <button
                className={effects === 'compatible' ? 'active' : ''}
                onClick={() => onChangeEffects('compatible')}
              >
                兼容
              </button>
            </div>
            <p className="muted">
              正文、表格与原件保持稳定内容面；兼容档关闭模糊和持续光效。
            </p>
          </section>

          {/* 动效控制 */}
          <section>
            <button className="btn" onClick={onToggleMotion}>
              <Icon name={motion ? 'pause' : 'play'} />
              {motion ? '暂停环境动态' : '恢复环境动态'}
            </button>
          </section>
        </div>
      </div>
    </div>
  );
}

function Icon({ name }: { name: string }) {
  return <i className={`icon icon-${name}`} />;
}
