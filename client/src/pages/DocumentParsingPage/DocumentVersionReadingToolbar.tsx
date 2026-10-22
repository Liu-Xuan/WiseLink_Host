import type { ReactNode } from 'react';
import { BookOpen, ClipboardList, FileText, MoreHorizontal } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Button } from '@client/src/components/ui/button';
import type { DocumentReadingLinks } from './document-reading-links';
import type { DocumentWorkbenchPanel } from './document-workbench-panel';

export function DocumentReadingIdentity({ number, title, version, current }: {
  number: string; title: string; version: string; current?: boolean;
}) {
  return <div className="document-reading-toolbar-identity">
    <div><h1>{number}</h1><span className="document-reading-business-version" title={
      `${version}${current === undefined ? '' : current ? ' · 库内当前版本' : ' · 历史版本'}`
    }>{version}{current === false ? ' · 历史' : ''}</span></div>
    <p title={title}>{title}</p>
  </div>;
}

export function DocumentReadingSavedLinks({ links, panelNavigation }: {
  links: DocumentReadingLinks & { loading: boolean };
  panelNavigation?: { active: DocumentWorkbenchPanel; routes: Record<'reader' | 'assessment' | 'wiki', string> & { interpretation?: string } };
}) {
  if (panelNavigation) return <nav className="document-reading-saved-links" aria-label="原文与同版本已保存工作">
    {([
      { panel: 'reader', label: '原文', icon: FileText },
      { panel: 'interpretation', label: '解读', icon: BookOpen },
      { panel: 'assessment', label: '评估', icon: ClipboardList },
      { panel: 'wiki', label: 'Wiki', icon: BookOpen },
    ] as const).filter(item => panelNavigation.routes[item.panel]).map(item => <Button key={item.panel} asChild variant="ghost" size="sm">
      <Link to={panelNavigation.routes[item.panel]!}
        aria-current={panelNavigation.active === item.panel ? 'page' : undefined}>
        <item.icon aria-hidden="true" />{item.label}
      </Link>
    </Button>)}
  </nav>;
  return <nav className="document-reading-saved-links" aria-label="同版本已保存工作">
    {links.assessmentRoute ? <Button asChild variant="ghost" size="sm">
      <Link to={links.assessmentRoute} title={links.assessmentNote}><ClipboardList aria-hidden="true" />评估</Link>
    </Button> : <Button variant="ghost" size="sm" disabled title={links.loading ? '正在核对同版本评估' : links.assessmentNote}>
      <ClipboardList aria-hidden="true" />评估
    </Button>}
    {links.wikiRoute ? <Button asChild variant="ghost" size="sm">
      <Link to={links.wikiRoute} title={links.wikiNote}><BookOpen aria-hidden="true" />Wiki</Link>
    </Button> : <Button variant="ghost" size="sm" disabled title={links.loading ? '正在核对同版本工程知识' : links.wikiNote}>
      <BookOpen aria-hidden="true" />Wiki
    </Button>}
  </nav>;
}

export function DocumentReadingMore({ children }: { children: ReactNode }) {
  return <details className="document-reading-more">
    <summary aria-label="更多文档信息与处理"><MoreHorizontal aria-hidden="true" />更多</summary>
    <div className="document-reading-more-panel">{children}</div>
  </details>;
}
