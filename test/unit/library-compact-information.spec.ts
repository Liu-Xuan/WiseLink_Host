import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { StaticRouter } from 'react-router-dom/server';
import { JSDOM } from 'jsdom';
import type { DocumentReadingPreview } from '@shared/document-reading.interface';
import { LibraryDocumentTableHead, LibraryDocumentVersionRow } from '@client/src/pages/WorkspaceHomePage/LibraryDocumentRows';
import { libraryDistinctBrief, libraryMatterSourceAta, libraryPublicationPresentation } from '@client/src/pages/WorkspaceHomePage/library-document-presentation';
import { libraryFamily, libraryMetadata } from './fixtures/canonical-library';
import { libraryMatterFixture } from './fixtures/library-matter';
import { LibraryAtaHierarchy } from '@client/src/pages/WorkspaceHomePage/LibraryAtaHierarchy';
jest.mock('@client/src/components/ui/button', () => ({ Button: 'button' }));

jest.mock('@client/src/api/canonical-host', () => ({
  getCanonicalHostClientSessionGeneration: () => 1,
  subscribeCanonicalHostClientSession: () => () => undefined,
}));

function fixture() {
  const document = libraryFamily('compact');
  for (const [index, version] of document.versions.entries()) {
    version.extractedMetadata = libraryMetadata(index ? '31-39' : '3461', '787-9');
    version.extractedMetadata.title.observations[0].value = index ? '历史文档标题' : '当前文档标题';
    version.extractedMetadata.issueDate = { status: 'PENDING_REVIEW', observations: [{
      value: index ? '2025-08-07' : '2026-10-01', status: 'PENDING_REVIEW', evidence: [{ page: 1, text: 'Issue date' }],
    }] };
  }
  return document;
}

function reading(brief: string): DocumentReadingPreview {
  return { status: 'AVAILABLE', reading: {
    readingRunRef: 'reading-compact', readingRevision: 1, headline: '当前文档标题', brief,
    criticalConditions: ['仅适用于已送达范围'], limitations: [], sourceLimitations: [],
    sourceBinding: { original: { documentVersionId: 'DV-compact-2', parseRunId: 'parse-1',
      parseRevision: 1, sourceArtifactId: 'artifact-1', sourceSha256: 'a'.repeat(64), sourceByteLength: 100 }, semanticRevision: 1 },
    coverageStatus: 'COMPLETE_DELIVERY', deliveredUnitCount: 1, totalUnitCount: 1, savedAt: '2026-10-01T00:00:00Z',
  } };
}

describe('compact library information from exact saved sources', () => {
  it('keeps classification navigation out of the main results and deduplicates versions with several ATA observations', () => {
    const document = fixture();
    document.versions[0].extractedMetadata!.ata.observations.push({ value: '3141', status: 'PENDING_REVIEW', evidence: [] });
    const render = (filters = {}) => new JSDOM(renderToStaticMarkup(createElement(StaticRouter, null,
      createElement(LibraryAtaHierarchy, { documents: [document], fleetCatalog: null, filters, hasMore: false,
        scheme: 'jasc', onSchemeChange: jest.fn(), onSelect: jest.fn() }))));
    const all = render();
    expect(all.window.document.querySelectorAll('tbody > tr')).toHaveLength(2);
    expect(all.window.document.querySelector('.library-category-tree')).toBeNull();
    expect(all.window.document.querySelector('.library-ata-toolbar')).toBeNull();
    all.window.close();
    const filtered = render({ ata: '3461' });
    expect(filtered.window.document.querySelectorAll('tbody > tr')).toHaveLength(1);
    expect(filtered.window.document.querySelector('tr[data-document-version-id]')?.getAttribute('data-document-version-id')).toBe('DV-compact-2');
    filtered.window.close();
  });
  it('puts each title, number, revision, source issue date, raw ATA and saved brief in its own field', () => {
    const document = fixture();
    document.versions[0].documentReading = reading('已保存摘要，只描述该版本已送达范围。');
    const markup = renderToStaticMarkup(createElement(StaticRouter, { location: '/library?ata=3461&catalogView=ata' },
      createElement('table', null, createElement(LibraryDocumentTableHead), createElement('tbody', null,
        ...document.versions.map(version => createElement(LibraryDocumentVersionRow, { key: version.documentVersionId,
          document, version, onSelect: jest.fn() }))))));
    const dom = new JSDOM(markup);
    const rows = [...dom.window.document.querySelectorAll('tbody > tr')];
    const cells = (index: number) => [...rows[index].querySelectorAll('td')].map(cell => cell.textContent);
    expect(cells(0).slice(0, 4)).toEqual([`当前文档标题${document.documentCode}`, 'R2当前', '2026-10-01', '3461']);
    expect(cells(1).slice(0, 4)).toEqual([`历史文档标题${document.documentCode}`, 'R1历史', '2025-08-07', '31-39']);
    expect(cells(0)[4]).toContain('已保存摘要');
    expect(rows[0].textContent!.match(/当前文档标题/gu)).toHaveLength(1);
    const url = new URL(rows[1].querySelector('a')!.getAttribute('href')!, 'https://example.test');
    expect(url.pathname).toBe('/document-versions/DV-compact-1');
    expect(url.searchParams.get('returnLibraryQuery')).toContain('selectedDocumentVersionId=DV-compact-1');
    expect(rows[0].querySelector('[data-reading-run-ref]')?.getAttribute('data-reading-run-ref')).toBe('reading-compact');
    expect(rows[0].querySelector('details')?.hasAttribute('open')).toBe(false);
    dom.window.close();
  });

  it('does not replace absent publication metadata with revision, generated or registration dates', () => {
    const version = fixture().versions[0];
    delete version.extractedMetadata!.issueDate;
    version.sourceGeneratedDate = '2024-01-01';
    expect(libraryPublicationPresentation(version)).toEqual({ issueDate: '未返回', ata: '3461' });
    expect(libraryPublicationPresentation(null)).toEqual({ issueDate: '未返回', ata: '未返回' });
  });

  it('keeps stale/retracted saved readings out of the summary and avoids repeating identical fields', () => {
    const document = fixture();
    document.versions[0].documentReading = { ...reading('STALE_UNSAFE_BRIEF'), status: 'SOURCE_CHANGED' };
    const html = renderToStaticMarkup(createElement(StaticRouter, null, createElement('table', null,
      createElement('tbody', null, createElement(LibraryDocumentVersionRow, {
        document, version: document.versions[0], onSelect: jest.fn(),
      })))));
    expect(html).not.toContain('STALE_UNSAFE_BRIEF');
    expect(html).toContain('来源已变化');
    expect(libraryDistinctBrief(' 当前文档标题 ', '当前文档标题')).toBe('与标题 / 编号相同');
    expect(libraryDistinctBrief('不同摘要', '当前文档标题')).toBe('不同摘要');
  });

  it('distinguishes unloaded matter membership and uses only exact included linked versions', () => {
    const document = fixture();
    const matter = libraryMatterFixture().matter;
    matter.materials = [
      { materialId: 'old', kind: 'MEMBER', disposition: 'INCLUDED', familyId: document.familyId,
        documentVersionId: document.versions[1].documentVersionId, scope: '', contribution: '', basis: [], origin: 'ENGINEER' },
      { materialId: 'excluded', kind: 'RELATED', disposition: 'EXCLUDED', familyId: document.familyId,
        documentVersionId: document.versions[0].documentVersionId, scope: '', contribution: '', basis: [], origin: 'ENGINEER' },
    ];
    const before = JSON.stringify({ matter, document });
    expect(libraryMatterSourceAta(null, [document])).toBe('未加载');
    expect(libraryMatterSourceAta(matter, [document])).toBe('31-39');
    expect(libraryMatterSourceAta(matter, [{ ...document, versions: [document.versions[0]] }])).toBe('未加载');
    matter.materials.push({ ...matter.materials[0], kind: 'MEMBER', familyId: document.familyId,
      materialId: 'not-loaded', documentVersionId: 'another-dv' });
    expect(libraryMatterSourceAta(matter, [document])).toBe('31-39 · 部分已加载');
    matter.materials.pop();
    expect(JSON.stringify({ matter, document })).toBe(before);
  });
});
