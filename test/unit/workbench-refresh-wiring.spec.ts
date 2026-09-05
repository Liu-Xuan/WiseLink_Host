import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

jest.mock('@client/src/components/ui/button', () => ({ Button: 'button' }));
jest.mock('@client/src/features/review/review-loop.css', () => ({}));

import ReviewImpactPreview from '../../client/src/features/review/ReviewImpactPreview';

const parsing = readFileSync(
  resolve(
    __dirname,
    '../../client/src/pages/DocumentParsingPage/DocumentParsingPage.tsx',
  ),
  'utf8',
);
const overview = readFileSync(
  resolve(
    __dirname,
    '../../client/src/features/workitem/WorkItemOverviewPage.tsx',
  ),
  'utf8',
);

// The load epoch tests exercise asynchronous delivery; these check page wiring.
describe('same-object refresh wiring', () => {
  it('only replaces the entire page when no same-session, same-object projection is visible', () => {
    expect(parsing).toContain('if (loading && data === null)');
    expect(parsing).toContain('if (!latestLoadRef.current.data)');
    expect(parsing).toMatch(
      /!authenticationRequired &&\s*pageSessionGeneration === sessionGeneration &&\s*pageData\?\.workItem.workItemId === workItemId/u,
    );
    expect(overview).toContain('if (loading && visibleView === null)');
    expect(overview).toContain('if (!currentScopeRef.current.visibleView)');
    expect(overview).toMatch(
      /!authenticationRequired &&\s*viewSessionGeneration === sessionGeneration &&\s*view\?\.id === workItemId/u,
    );
    for (const source of [parsing, overview]) {
      expect(source).toContain('仍显示上次读回的内容，尚未确认最新状态');
      expect(source).toContain(
        'disabled: loading || overallRegeneration.disabled',
      );
    }
  });

  it('still removes the displayed projection on failed reads instead of masking source or access failure', () => {
    expect(parsing).toMatch(
      /onDenied: \(identity, cause\) => \{\s*setPageData\(null\);\s*setPageSessionGeneration\(null\)/u,
    );
    expect(parsing).toMatch(
      /onIdentityError: \(cause\) => \{\s*setPageData\(null\);\s*setPageSessionGeneration\(null\)/u,
    );
    expect(parsing).toContain('documentFailureAllowsReviewReadback(cause)');
    expect(overview).toMatch(
      /catch \(reason\) \{\s*if \(isCurrentSession\(\)\) \{\s*setView\(null\);\s*setContextView\(null\);\s*setViewSessionGeneration\(null\)/u,
    );
  });

  it('resolves a handoff only in the lazy initial state, with no time-varying effect dependency or later reapplication', () => {
    expect(parsing).toMatch(
      /useState<CanonicalDocumentParsingPageResponse \| null>\(\(\) =>[\s\S]*?resolveCanonicalDocumentParsingRouteHandoff\(/u,
    );
    expect(
      parsing.match(/resolveCanonicalDocumentParsingRouteHandoff\(/gu),
    ).toHaveLength(1);
    expect(parsing).not.toMatch(/setPageData\(routeHandoff\)/u);
    expect(parsing).toContain('initialHandoffScopeRef.current = null');
    expect(parsing).toContain(
      'handoffScope.sessionGeneration === sessionGeneration',
    );
    expect(parsing).toContain('handoffScope.query === activeQuery');
    expect(parsing).toContain(
      'handoffScope.sourceRef === activeReaderSourceRef',
    );
  });

  it('delivers Overall to the current route scope and pauses writes without removing review draft editors', () => {
    expect(parsing).toContain(
      'await current.load(current.query, current.sourceRef, fresh)',
    );
    expect(parsing).toContain(
      'canReuseCanonicalDocumentParsingReadback(readback,',
    );
    expect(parsing).toContain(
      'currentRevision: latestLoadRef.current.data?.workItem.revision',
    );
    expect(parsing).toContain('if (readback) return readProjection()');
    expect(parsing).toContain("freshness: 'mutation'");
    expect(parsing).toContain('workItemRefreshing={loading}');
    expect(parsing).toMatch(
      /<ReviewImpactPreview[\s\S]*?refreshing=\{loading\}/u,
    );
    expect(parsing).toContain('scrolledNodesRef.current.has(destination)');
    expect(parsing).not.toMatch(/\binert[=\s>]/u);
  });

  it('disables confirmation during refresh without pretending a write is in progress', () => {
    const html = renderToStaticMarkup(
      createElement(ReviewImpactPreview, {
        open: true,
        criterionLabel: 'C-1',
        criterionConclusion: '上次读回的候选',
        decision: '确认',
        comment: '保留的草稿',
        overallStatus: null,
        submitting: false,
        refreshing: true,
        onCancel: jest.fn(),
        onConfirm: jest.fn(),
      }),
    );
    expect(html).toContain('保留的草稿');
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>/u);
    expect(html).not.toContain('正在写入');
  });
});
