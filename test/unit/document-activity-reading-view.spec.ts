import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { StaticRouter } from 'react-router-dom/server';

import DocumentActivityReadingView, {
  sliceSourceText,
} from '../../client/src/pages/DocumentParsingPage/DocumentActivityReadingView';

jest.mock('@client/src/components/ui/badge', () => ({ Badge: 'span' }));
jest.mock('@client/src/components/ui/card', () => ({
  Card: 'section',
  CardContent: 'div',
  CardHeader: 'header',
  CardTitle: 'h2',
}));
import type {
  DocumentActivityRevision,
  DocumentActivityStatement,
} from '@shared/document-activity.interface';
import type { DocumentOriginalBinding } from '@shared/document-original.interface';

const binding: DocumentOriginalBinding = {
  documentVersionId: 'DV1',
  parseRunId: 'PR1',
  parseRevision: 3,
  sourceArtifactId: 'ART1',
  sourceSha256: 'sha',
  sourceByteLength: 10,
};

function makeCandidate(overrides?: Partial<DocumentActivityRevision>): DocumentActivityRevision {
  return {
    schemaVersion: 'wiselink.document.activity-candidate.v1',
    runRef: 'run-1',
    candidateRevision: 4,
    candidateOnly: true,
    sourceBinding: { original: binding, semanticRevision: 3 },
    producer: { skillVersion: 'skill-1', modelVersion: 'model-1' },
    savedAt: '2026-09-15T00:00:00.000Z',
    readCoverage: {
      status: 'DELIVERED_RANGES_ONLY',
      selection: { sectionIds: ['S1'] },
      deliveredRanges: [
        { sectionId: 'S1', offset: 0, unitIds: ['U1'], anchorIds: ['A1'], nextOffset: null },
      ],
      sourceCoverage: { knownPageCount: 2, readPageIndexes: [0], unresolvedRanges: [] },
    },
    statements: [],
    sourceAnchors: [],
    ...overrides,
  };
}

function render(props: Partial<Parameters<typeof DocumentActivityReadingView>[0]>) {
  return renderToStaticMarkup(
    createElement(
      StaticRouter,
      { location: '/' },
      createElement(DocumentActivityReadingView, {
        binding,
        familyId: 'FAM1',
        candidate: null,
        selectedStatementId: null,
        selectedAnchorId: null,
        ...props,
      }),
    ),
  );
}

describe('sliceSourceText strict UTF-16', () => {
  test('slices by code units and keeps emoji intact', () => {
    const source = '2024-05-01 😀 生效';
    expect(sliceSourceText(source, 11, 13)).toBe('😀');
    expect(sliceSourceText(source, 0, source.length)).toBe(source);
    expect(sliceSourceText('a😀b', 1, 3)).toBe('😀');
    expect(sliceSourceText('a😀b', 0, 4)).toBe('a😀b');
  });

  test('rejects out-of-range offsets instead of clamping', () => {
    const source = 'abc';
    expect(sliceSourceText(source, 0, 4)).toBeNull();
    expect(sliceSourceText(source, -1, 2)).toBeNull();
    expect(sliceSourceText(source, 2, 1)).toBeNull();
    expect(sliceSourceText(source, 0, Number.MAX_SAFE_INTEGER + 1)).toBeNull();
  });
});

describe('candidate states', () => {
  test('a null candidate means no saved candidate, not the absence of activities', () => {
    const markup = render({ candidate: null });
    expect(markup).toContain('未保存候选');
    expect(markup).toContain('没有已保存的活动候选');
    expect(markup).toContain('这不表示该文档没有活动');
    expect(markup).not.toContain('读取覆盖');
  });

  test('an empty statement list still keeps coverage and anchors', () => {
    const markup = render({ candidate: makeCandidate() });
    expect(markup).toContain('不包含任何声明');
    expect(markup).toContain('读取覆盖（仅按已送达范围）');
    expect(markup).toContain('已送达范围 1 段');
  });

  test('shows candidate identity, producer and the saved-time disclaimer', () => {
    const markup = render({ candidate: makeCandidate() });
    expect(markup).toContain('候选改版 4');
    expect(markup).toContain('运行标识 run-1');
    expect(markup).toContain('skill-1 / model-1');
    expect(markup).toContain('保存时间不是活动时间');
    expect(markup).toContain('候选仅表示模型对原文引用的解读');
  });
});

describe('statement rendering', () => {
  const statement: DocumentActivityStatement = {
    statementId: 'ST1',
    statementKey: 'K1',
    label: 'SB 修订生效',
    time: { raw: '2024年5月1日', role: 'EFFECTIVE', precision: 'DAY', expression: 'CALENDAR', quoteIndex: 0 },
    statusRaw: 'EFFECTIVE',
    quotes: [],
    limitations: ['仅适用于 747-400'],
  };

  test('renders label, time raw, role, precision, expression, statusRaw and limitations', () => {
    const markup = render({ candidate: makeCandidate({ statements: [statement] }) });
    expect(markup).toContain('SB 修订生效');
    expect(markup).toContain('2024年5月1日');
    expect(markup).toContain('EFFECTIVE');
    expect(markup).toContain('精度 DAY');
    expect(markup).toContain('表述 CALENDAR');
    expect(markup).toContain('状态原词：EFFECTIVE');
    expect(markup).toContain('限制：仅适用于 747-400');
  });

  test('a null time renders as not extracted', () => {
    const markup = render({
      candidate: makeCandidate({ statements: [{ ...statement, time: null }] }),
    });
    expect(markup).toContain('时间未提取');
  });

  test('an unknown selected statement refuses to default to another item', () => {
    const markup = render({
      candidate: makeCandidate({ statements: [statement] }),
      selectedStatementId: 'ST-unknown',
    });
    expect(markup).toContain('无法定位声明 ST-unknown');
    expect(markup).toContain('不会默认选择其他声明');
    expect(markup).not.toContain('当前选择');
  });

  test('an unknown selected anchor is surfaced without a fallback', () => {
    const markup = render({ candidate: makeCandidate(), selectedAnchorId: 'A-unknown' });
    expect(markup).toContain('无法定位锚点 A-unknown');
  });
});

describe('quotes and anchors', () => {
  const sourceText = '2024-05-01 😀 生效范围';
  function makeLocator(overrides: { sourceRefId: string; kind: string; pageStart: number | null; pageEnd: number | null; normalizedPath: string | null }) {
    return {
      artifactId: null,
      charStart: null,
      charEnd: null,
      charOffsetUnit: null,
      xpath: null,
      elementId: null,
      quote: null,
      bbox: null,
      ...overrides,
    };
  }
  const anchorEmoji = {
    anchorId: 'A1',
    sourceUnitId: 'U1',
    payloadPath: '/text/2',
    sourceText,
    sourceRefIds: ['SR1', 'SR2'],
    sourceLocators: [
      makeLocator({ sourceRefId: 'SR1', kind: 'page', pageStart: 1, pageEnd: 2, normalizedPath: null }),
      makeLocator({ sourceRefId: 'SR2', kind: 'path', pageStart: null, pageEnd: null, normalizedPath: '/doc/x.md' }),
    ],
  };
  const candidate = () =>
    makeCandidate({
      statements: [
        {
          statementId: 'ST1',
          statementKey: 'K1',
          label: '生效声明',
          time: null,
          statusRaw: null,
          quotes: [{ anchorId: 'A1', start: 11, end: 13, text: '😀' }],
          limitations: [],
        },
      ],
      sourceAnchors: [anchorEmoji],
    });

  test('quote slices render the exact UTF-16 span including emoji, untruncated', () => {
    const markup = render({ candidate: candidate() });
    expect(markup).toContain('😀');
    expect(markup).toContain('（A1 · 11–13）');
    expect(markup).toContain(sourceText);
  });

  test('an out-of-range quote falls back to the saved quote text with a note', () => {
    const outOfRange = makeCandidate({
      statements: [
        {
          statementId: 'ST1',
          statementKey: 'K1',
          label: '声明',
          time: null,
          statusRaw: null,
          quotes: [{ anchorId: 'A1', start: 0, end: 99, text: '保存的引文' }],
          limitations: [],
        },
      ],
      sourceAnchors: [anchorEmoji],
    });
    const markup = render({ candidate: outOfRange });
    expect(markup).toContain('保存的引文');
    expect(markup).toContain('引用区间超出锚点原文范围');
  });

  test('anchors expose source text, unit, payload path and locators', () => {
    const markup = render({ candidate: candidate() });
    expect(markup).toContain('单元 U1');
    expect(markup).toContain('载荷路径 /text/2');
    expect(markup).toContain('第 2–3 页');
    expect(markup).toContain('/doc/x.md');
  });

  test('every real source ref gets a pinned reader link and round-trips the activity selection', () => {
    const markup = render({
      candidate: candidate(),
      selectedStatementId: 'ST1',
      returnParamsFor: (b) =>
        b.documentVersionId === 'DV1' ? 'returnDocumentVersionId=DV1&returnActivityQuery=x' : null,
    });
    expect(markup).toContain('/document-versions/DV1?parseRunId=PR1&amp;sourceRef=SR1');
    expect(markup).toContain('/document-versions/DV1?parseRunId=PR1&amp;sourceRef=SR2');
    expect(markup).toContain('returnActivityQuery=x');
    expect(markup).not.toContain('无来源标识');
  });

  test('empty statements still show every saved anchor with working source links', () => {
    const markup = render({
      candidate: makeCandidate({ statements: [], sourceAnchors: [anchorEmoji] }),
      returnParamsFor: () => 'returnDocumentVersionId=DV1&returnActivityQuery=x',
    });
    expect(markup).toContain('不包含任何声明');
    expect(markup).toContain('原文来源锚点');
    expect(markup).toContain('锚点 A1');
    expect(markup).toContain('/document-versions/DV1?parseRunId=PR1&amp;sourceRef=SR1');
    expect(markup).toContain('returnActivityQuery=x');
  });

  test('anchors no statement quotes render once after dedupe and carry no statement context', () => {
    const calls: Array<{ statementId: string | null | undefined; anchorId: string | null | undefined }> = [];
    const markup = render({
      candidate: makeCandidate({
        statements: [],
        sourceAnchors: [anchorEmoji, { ...anchorEmoji }, { ...anchorEmoji }],
      }),
      returnParamsFor: (b, statementId, anchorId) => {
        calls.push({ statementId, anchorId });
        return 'returnDocumentVersionId=DV1&returnActivityQuery=x';
      },
    });
    expect(markup.match(/锚点 A1<\/summary>/gu)).toHaveLength(1);
    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) {
      expect(call.statementId).toBeNull();
      expect(call.anchorId).toBe('A1');
    }
  });

  test('a candidate-level anchor is shown without a fabricated statement while quoted anchors keep theirs', () => {
    const withCandidateLevel = makeCandidate({
      statements: [
        {
          statementId: 'ST1',
          statementKey: 'K1',
          label: '生效声明',
          time: null,
          statusRaw: null,
          quotes: [{ anchorId: 'A1', start: 11, end: 13, text: '😀' }],
          limitations: [],
        },
      ],
      sourceAnchors: [
        anchorEmoji,
        { ...anchorEmoji, anchorId: 'A2', sourceText: '未引用原文', sourceRefIds: ['SR9'] },
      ],
    });
    const calls: Array<{ statementId: string | null | undefined; anchorId: string | null | undefined }> = [];
    const markup = render({
      candidate: withCandidateLevel,
      returnParamsFor: (b, statementId, anchorId) => {
        calls.push({ statementId, anchorId });
        return 'returnDocumentVersionId=DV1&returnActivityQuery=x';
      },
    });
    expect(markup).toContain('原文来源锚点');
    expect(markup).toContain('锚点 A2');
    expect(markup).toContain('原文 SR9');
    const a1 = calls.filter((call) => call.anchorId === 'A1');
    expect(a1.some((call) => call.statementId === 'ST1')).toBe(true);
    const a2 = calls.filter((call) => call.anchorId === 'A2');
    expect(a2.length).toBeGreaterThan(0);
    for (const call of a2) expect(call.statementId).toBeNull();
  });
});

describe('coverage display', () => {
  test('distinguishes selection, delivered ranges and unresolved diagnostics without claiming full reading', () => {
    const markup = render({
      candidate: makeCandidate({
        readCoverage: {
          status: 'DELIVERED_RANGES_ONLY',
          selection: { sectionIds: ['S1', 'S2'] },
          deliveredRanges: [
            { sectionId: 'S1', offset: 0, unitIds: ['U1'], anchorIds: ['A1'], nextOffset: null },
            { sectionId: 'S2', offset: 4, unitIds: ['U2'], anchorIds: ['A2'], nextOffset: null },
          ],
          sourceCoverage: {
            knownPageCount: 5,
            readPageIndexes: [0, 2],
            unresolvedRanges: [
              {
                reason: 'UNREAD',
                readingImpact: 'DIAGNOSTIC',
                message: '扫描件未送达',
                pageIndexes: [1],
                unitIds: ['U3'],
              },
              {
                reason: 'TEXT_CONFLICT',
                message: '文本与图示冲突',
                pageIndexes: [3],
                unitIds: [],
              },
            ],
          },
        },
      }),
    });
    expect(markup).toContain('选择章节：S1、S2');
    expect(markup).toContain('已送达范围 2 段：S1、S2');
    expect(markup).toContain('原件页数：5');
    expect(markup).toContain('已读取第 1、3 页');
    expect(markup).toContain('第 2 页 · 单元 U3：未读取 · 扫描件未送达 · 诊断');
    expect(markup).toContain('第 4 页：文本冲突 · 文本与图示冲突 · 未分类');
    expect(markup).toContain('覆盖记录 · 第 2 页 · 单元 U3 · 未读取 · 扫描件未送达 · 诊断');
    expect(markup).toContain('覆盖记录 · 第 4 页 · 文本冲突 · 文本与图示冲突 · 未分类');
    expect(markup).not.toContain('未解析');
    expect(markup).toContain('不宣称已读取全文');
  });

  test('range details expand every delivered field and unit-only unresolved ranges never show an empty page label', () => {
    const markup = render({
      candidate: makeCandidate({
        readCoverage: {
          status: 'DELIVERED_RANGES_ONLY',
          selection: { sectionIds: ['S1'] },
          deliveredRanges: [
            { sectionId: 'S1', offset: 0, unitIds: ['U1', 'U2'], anchorIds: ['A1'], nextOffset: 12 },
            { sectionId: 'S2', offset: 4, unitIds: [], anchorIds: [], nextOffset: null },
          ],
          sourceCoverage: {
            knownPageCount: 5,
            readPageIndexes: [0],
            unresolvedRanges: [
              { reason: 'UNREAD', message: '扫描件未送达', pageIndexes: [], unitIds: ['U9'] },
            ],
          },
        },
      }),
    });
    expect(markup).toContain('范围明细（已送达 2 段 · 待核范围 1 段）');
    expect(markup).toContain('已送达 · 章节 S1 · 偏移 0 · 单元 U1、U2 · 锚点 A1 · 续读偏移 12');
    expect(markup).toContain('已送达 · 章节 S2 · 偏移 4 · 单元 （无） · 锚点 （无） · 续读偏移 （无）');
    expect(markup).toContain('覆盖记录 · 单元 U9 · 未读取 · 扫描件未送达 · 未分类');
    expect(markup).not.toContain('第 页');
  });
});
