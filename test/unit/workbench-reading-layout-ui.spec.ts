import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

jest.mock('@client/src/app/providers/ThemeProvider', () => ({
  useWlTheme: () => ({ reduceTransparency: false, toggleTransparency: jest.fn() }),
}));
jest.mock('@client/src/features/workbench/QuickOpen', () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock('@client/src/features/workbench/workbench-shell.css', () => ({}));
jest.mock('@client/src/components/ui/dropdown-menu', () => ({
  DropdownMenu: () => null,
  DropdownMenuCheckboxItem: 'span',
  DropdownMenuContent: 'span',
  DropdownMenuItem: 'span',
  DropdownMenuLabel: 'span',
  DropdownMenuSeparator: 'span',
  DropdownMenuTrigger: 'span',
}));
import WorkbenchShell from '../../client/src/features/workbench/WorkbenchShell';

function render(readingLayout: boolean): string {
  return renderToStaticMarkup(createElement(WorkbenchShell, {
    readingLayout,
    contentMode: readingLayout ? 'workspace' : 'flow',
    contextLabel: 'Test document',
    navigator: createElement('p', null, 'Navigation contents'),
    evidencePanel: createElement('p', null, 'Evidence contents'),
    evidenceContentCount: 2,
    tabs: [{ key: 'reader', label: 'PDF 原文' }],
    activeTab: 'reader',
    onTabChange: jest.fn(),
    children: createElement('p', null, 'Reading contents'),
  }));
}

describe('reading-first workbench layout', () => {
  it('starts reading with auxiliary panes closed, tabs and fullscreen accessible', () => {
    const html = render(true);
    expect(html).toContain('is-immersive is-focus-mode');
    expect(html).toContain('aria-label="展开资料目录"');
    expect(html).toContain('aria-label="展开原文依据"');
    expect(html).toContain('aria-label="全屏阅读"');
    expect(html).toContain('aria-label="退出专注阅读"');
    expect(html).toContain('role="tablist"');
    expect(html).not.toContain('Navigation contents');
    expect(html).not.toContain('Evidence contents');
    expect(html).toContain('Reading contents');
  });

  it('does not force the reading layout on ordinary assessment workspaces', () => {
    const html = render(false);
    expect(html).not.toContain('is-immersive is-focus-mode');
    expect(html).toContain('aria-label="进入专注阅读"');
    expect(html).toContain('Reading contents');
  });
});
