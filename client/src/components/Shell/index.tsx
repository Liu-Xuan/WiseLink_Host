/**
 * Shell - WiseLink 统一外壳组件
 *
 * 基于 Suite 1.1 设计
 * 提供全局导航、当前事项导航、搜索、主题切换等功能
 */

import React, { useState, useEffect, type ReactNode } from 'react';
import { GlobalNav } from './GlobalNav';
import { MatterNav } from './MatterNav';
import { Topbar } from './Topbar';
import { Breadcrumb } from './Breadcrumb';
import { SettingsModal } from './SettingsModal';

export interface ShellProps {
  children: ReactNode;
  currentPage: string;
  currentMatter?: {
    id: string;
    title: string;
    code: string;
  };
  currentDocument?: {
    id: string;
    title: string;
    version: string;
  };
  mode?: 'preview' | 'production';
  onNavigate?: (page: string, params?: Record<string, any>) => void;
  onBack?: () => void;
}

export interface ShellState {
  theme: 'light' | 'dark';
  effects: 'default' | 'ultra' | 'compatible';
  motion: boolean;
  immersive: boolean;
  menuOpen: boolean;
  showSettings: boolean;
}

export function Shell({
  children,
  currentPage,
  currentMatter,
  currentDocument,
  mode = 'production',
  onNavigate,
  onBack,
}: ShellProps) {
  // 状态管理
  const [state, setState] = useState<ShellState>({
    theme: 'light',
    effects: 'default',
    motion: true,
    immersive: false,
    menuOpen: false,
    showSettings: false,
  });

  // 从 localStorage 恢复设置
  useEffect(() => {
    const saved = localStorage.getItem('wiselink-settings');
    if (saved) {
      try {
        const settings = JSON.parse(saved);
        setState(prev => ({
          ...prev,
          theme: settings.theme || 'light',
          effects: settings.effects || 'default',
          motion: settings.motion !== false,
        }));
      } catch (e) {
        // Failed to restore settings
      }
    }
  }, []);

  // 保存设置到 localStorage
  const saveSettings = (updates: Partial<ShellState>) => {
    setState(prev => {
      const next = { ...prev, ...updates };
      localStorage.setItem('wiselink-settings', JSON.stringify({
        theme: next.theme,
        effects: next.effects,
        motion: next.motion,
      }));
      return next;
    });
  };

  // 键盘快捷键
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // ESC - 退出全屏/关闭菜单
      if (e.key === 'Escape') {
        setState(prev => ({
          ...prev,
          immersive: false,
          menuOpen: false,
        }));
      }

      // / - 聚焦搜索
      if (e.key === '/' && !['INPUT', 'TEXTAREA', 'SELECT'].includes((e.target as HTMLElement).tagName)) {
        e.preventDefault();
        const searchInput = document.getElementById('global-search');
        searchInput?.focus();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const navigate = (page: string, params?: Record<string, any>) => {
    onNavigate?.(page, params);
  };

  const toggleImmersive = () => {
    setState(prev => ({ ...prev, immersive: !prev.immersive }));
  };

  const toggleMenu = () => {
    setState(prev => ({ ...prev, menuOpen: !prev.menuOpen }));
  };

  return (
    <div
      className={`wl-studio ${state.immersive ? 'immersive' : ''} ${state.menuOpen ? 'menu-open' : ''}`}
      data-theme={state.theme}
      data-effects={state.effects}
      data-motion={state.motion ? 'on' : 'off'}
    >
      {/* 左侧边栏 */}
      <GlobalNav
        currentPage={currentPage}
        onNavigate={navigate}
        onOpenSettings={() => setState(prev => ({ ...prev, showSettings: true }))}
      />

      {/* 当前事项导航 */}
      {currentMatter && (
        <MatterNav
          matter={currentMatter}
          currentPage={currentPage}
          onNavigate={navigate}
        />
      )}

      {/* 主内容区 */}
      <section className="main-shell">
        {/* 顶部栏 */}
        <Topbar
          mode={mode}
          menuOpen={state.menuOpen}
          onToggleMenu={toggleMenu}
          onSearch={(query) => navigate('knowledge', { query })}
        />

        {/* 面包屑 */}
        <Breadcrumb
          currentPage={currentPage}
          currentMatter={currentMatter}
          currentDocument={currentDocument}
          immersive={state.immersive}
          onBack={onBack}
          onToggleImmersive={toggleImmersive}
          onNavigate={navigate}
        />

        {/* 页面内容 */}
        <main className={`page-content page-${currentPage}`}>
          {children}
        </main>
      </section>

      {/* 设置弹窗 */}
      {state.showSettings && (
        <SettingsModal
          theme={state.theme}
          effects={state.effects}
          motion={state.motion}
          onChangeTheme={(theme) => saveSettings({ theme })}
          onChangeEffects={(effects) => saveSettings({ effects })}
          onToggleMotion={() => saveSettings({ motion: !state.motion })}
          onClose={() => setState(prev => ({ ...prev, showSettings: false }))}
        />
      )}
    </div>
  );
}
