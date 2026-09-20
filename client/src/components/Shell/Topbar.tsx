/**
 * Topbar - 顶部栏组件
 *
 * 包含：
 * - 菜单切换按钮（移动端）
 * - 全局搜索框
 * - 模式标识
 * - 用户信息
 */

import React, { useState, FormEvent } from 'react';

interface TopbarProps {
  mode: 'preview' | 'production';
  menuOpen: boolean;
  onToggleMenu: () => void;
  onSearch: (query: string) => void;
}

export function Topbar({ mode, menuOpen, onToggleMenu, onSearch }: TopbarProps) {
  const [searchQuery, setSearchQuery] = useState('');

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (searchQuery.trim()) {
      onSearch(searchQuery.trim());
    }
  };

  return (
    <header className="topbar">
      {/* 菜单切换（移动端） */}
      <button
        className="menu-toggle"
        aria-label="展开导航"
        onClick={onToggleMenu}
      >
        <Icon name="list" />
      </button>

      {/* 搜索框 */}
      <form className="searchbar" onSubmit={handleSubmit}>
        <Icon name="search" />
        <input
          id="global-search"
          type="search"
          placeholder="搜索工程问题、ATA章节、文件与已有认识…"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
        <kbd>/</kbd>
      </form>

      {/* 右侧信息 */}
      <div className="top-right">
        <span className="badge">
          {mode === 'preview' ? '示例空间' : '工程知识空间'}
        </span>
        <span className="avatar">工</span>
        <div className="top-user">
          系统工程师
          <small>工程技术工作空间</small>
        </div>
      </div>
    </header>
  );
}

function Icon({ name }: { name: string }) {
  return <i className={`icon icon-${name}`} />;
}
