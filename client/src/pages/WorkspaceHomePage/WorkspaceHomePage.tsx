import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowRight,
  BookOpenCheck,
  FileStack,
  Radar,
  ShieldCheck,
  Workflow,
} from 'lucide-react';

import './workspace-home.css';

const WORKSPACES = [
  {
    icon: FileStack,
    label: '资料与版本',
    detail: 'DocumentVersion、currentness、原件与来源身份。',
  },
  {
    icon: BookOpenCheck,
    label: '阅读与解析',
    detail: 'frozen.2、完整 Validator、Reader 与来源定位。',
  },
  {
    icon: Workflow,
    label: '评估与编写',
    detail: 'OpenClaw 动态 N、整体候选、人工复核与 AEO 产物。',
  },
  {
    icon: Radar,
    label: '外部资料',
    detail: '公开发现、候选审核；真实字节到位后才进入 DM。',
  },
] as const;

export default function WorkspaceHomePage() {
  const navigate = useNavigate();
  const [workItemId, setWorkItemId] = useState('');

  function openWorkItem(): void {
    const normalized = workItemId.trim();
    if (!normalized) return;
    navigate(`/work-items/${encodeURIComponent(normalized)}/documents`);
  }

  return (
    <main className="workspace-home">
      <section className="workspace-home-hero">
        <div>
          <p>WISELINK 3.1 · CANONICAL ENGINEERING WORKSPACE</p>
          <h1>把资料、评估与编写，放回同一个工程事项。</h1>
          <span>
            这是唯一正式妙搭应用。历史模块贡献页面和交互，不再保留独立应用、
            独立 WorkItem 或第二套状态。
          </span>
        </div>
        <div className="workspace-home-boundary">
          <ShieldCheck aria-hidden="true" />
          <strong>ONE APP</strong>
          <span>同一权限 · 同一 WorkItem · 同一实际字节</span>
        </div>
      </section>

      <form
        className="workspace-home-entry"
        onSubmit={(event) => {
          event.preventDefault();
          openWorkItem();
        }}
      >
        <label htmlFor="canonical-work-item-id">打开 WorkItem</label>
        <input
          id="canonical-work-item-id"
          value={workItemId}
          onChange={(event) => setWorkItemId(event.target.value)}
          placeholder="WI-…"
          autoComplete="off"
        />
        <button type="submit" disabled={!workItemId.trim()}>
          进入统一工作台 <ArrowRight aria-hidden="true" />
        </button>
        <small>页面只按服务端 fresh-read 展示；不存在时不会回退样本。</small>
      </form>

      <section className="workspace-home-grid" aria-label="统一工作区">
        {WORKSPACES.map((workspace, index) => (
          <article key={workspace.label}>
            <span>{String(index + 1).padStart(2, '0')}</span>
            <workspace.icon aria-hidden="true" />
            <h2>{workspace.label}</h2>
            <p>{workspace.detail}</p>
          </article>
        ))}
      </section>
    </main>
  );
}
