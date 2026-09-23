import { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import type { CanonicalDocumentParsingPageResponse } from '@shared/api.interface';
import { DocumentReaderWorkspace } from '../../client/src/pages/DocumentParsingPage/DocumentReaderWorkspace';

jest.mock('@client/src/components/ui/button', () => ({
  Button: ({ children, ...props }: { children: ReactNode }) =>
    createElement('button', props, children),
}));
jest.mock('@client/src/components/ui/input', () => ({
  Input: (props: Record<string, unknown>) => createElement('input', props),
}));
jest.mock('../../client/src/pages/DocumentParsingPage/SemanticBilingualReader', () => ({
  SemanticBilingualReader: () => null,
}));

function renderReader(packageBound: boolean, query: string): string {
  const data = {
    workItem: {
      source: { documentVersionId: 'DV-1', sourceByteLength: 100 },
      package: packageBound ? { title: 'Legacy package' } : null,
    },
    entry: null,
    initialAnalysis: null,
    readerProjection: {
      sourceKind: 'native_s1000d',
      structuredUnitCount: 0,
      sourceRefCount: 0,
      query,
      units: [],
      translation: { status: 'UNAVAILABLE', reason: 'NOT_READY' },
      pdfPreview: { status: 'UNAVAILABLE' },
    },
  } as unknown as CanonicalDocumentParsingPageResponse;
  return renderToStaticMarkup(
    createElement(MemoryRouter, null,
      createElement(DocumentReaderWorkspace, {
        data,
        query,
        requestedSourceRef: '',
        selectedReaderResult: undefined,
        readerMode: 'structured',
        onQueryChange: () => undefined,
        onQuerySubmit: () => undefined,
        onReaderModeChange: () => undefined,
        onSourceRefSelect: () => undefined,
        onClearSourceRef: () => undefined,
        onBrowseStructured: () => undefined,
      })),
  );
}

describe('reader zero-result explanation', () => {
  it('links a work item without a legacy package to the actual document version', () => {
    const html = renderReader(false, '');
    expect(html).toContain('不代表文档版本的已发布原文为空');
    expect(html).toContain('/document-versions/DV-1');
    expect(html).not.toContain('没有匹配的来源绑定单元');
  });

  it('offers full package browse before search and a true no-match state after search', () => {
    const beforeSearch = renderReader(true, '');
    expect(beforeSearch).toContain('尚未查询来源绑定单元');
    expect(beforeSearch).toContain('浏览完整结构化内容</button>');
    expect(beforeSearch).not.toContain('href="?panel=package"');
    const afterSearch = renderReader(true, 'missing');
    expect(afterSearch).toContain('当前条件没有匹配的来源绑定单元');
    expect(afterSearch).not.toContain('尚未查询来源绑定单元');
  });
});
