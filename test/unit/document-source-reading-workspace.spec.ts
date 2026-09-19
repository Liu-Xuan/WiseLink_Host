import { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';

import { DocumentSourceReadingWorkspace } from '../../client/src/pages/DocumentParsingPage/DocumentSourceReadingWorkspace';
import { originalFixture } from './document-parsing/fixtures/document-original.fixture';

jest.mock('@client/src/pages/WorkspaceHomePage/DocumentOriginalPreview', () => ({
  DocumentOriginalPreview: ({ children }: { children: string }) => createElement('span', null, children),
  DocumentOriginalInlinePreview: ({ page }: { page: number }) => createElement('div', { 'data-pdf-page': page }, 'PDF'),
}));
jest.mock('@client/src/components/ui/button', () => ({
  Button: ({ asChild, children, ...props }: { asChild?: boolean; children: ReactNode }) =>
    asChild ? children : createElement('button', props, children),
}));

function markup(mode: 'dual' | 'bilingual' | 'translation' | 'original' | 'pdf' = 'dual') {
  const original = originalFixture();
  original.binding.parseRevision = 7;
  original.source.units[0] = {
    ...original.source.units[0],
    kind: 'heading',
    payload: { text: '1. Investigation scope' },
  };
  original.source.units = [original.source.units[0]];
  return renderToStaticMarkup(
    createElement(
      MemoryRouter,
      null,
      createElement(DocumentSourceReadingWorkspace, {
        original,
        documentVersionId: original.binding.documentVersionId,
        mode,
        onModeChange: () => undefined,
        bilingualContent: createElement('div', null, '已保存中英内容'),
        returnRoute: '/library?mode=document',
        returnLabel: '返回文档库',
        title: 'SB-A R02.pdf',
        initialPage: 3,
      }),
    ),
  );
}

describe('document source reading workspace', () => {
  it('renders the exact source outline, fixed parse revision and accessible split control', () => {
    const html = markup();
    expect(html).toContain('1. Investigation scope');
    expect(html).toContain('阅读版本 7');
    expect(html).toContain('业务主题目录暂不可用');
    expect(html).toContain('role="separator"');
    expect(html).toContain('aria-valuenow="50"');
    expect(html).toContain('data-pdf-page="3"');
  });

  it('keeps the five reader modes and renders saved Chinese content only in Chinese modes', () => {
    const dual = markup('dual');
    const bilingual = markup('bilingual');
    const translation = markup('translation');
    expect(dual).toContain('原文＋原件');
    expect(dual).toContain('中英对照');
    expect(dual).toContain('中文阅读');
    expect(dual).toContain('仅原文');
    expect(dual).toContain('仅原件');
    expect(dual).not.toContain('已保存中英内容');
    expect(bilingual).toContain('已保存中英内容');
    expect(translation).toContain('已保存中英内容');
    expect(bilingual).not.toContain('role="separator"');
  });
});
