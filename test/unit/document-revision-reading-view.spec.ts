import { createElement } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { renderToStaticMarkup } from 'react-dom/server';
import type { DocumentRevisionReadingResponse, DocumentRevisionReadingSide } from '../../shared/document-revision-reading.interface';
import DocumentRevisionReadingView from '../../client/src/pages/DocumentParsingPage/DocumentRevisionReadingView';

jest.mock('@client/src/components/ui/badge', () => ({ Badge: 'span' }));
jest.mock('@client/src/components/ui/card', () => ({ Card: 'section', CardHeader: 'header', CardTitle: 'h2', CardContent: 'div' }));

function side(documentVersionId: string, text: string): DocumentRevisionReadingSide {
  const binding = { documentVersionId, parseRunId: `PR-${documentVersionId}`, parseRevision: 1, sourceArtifactId: `A-${documentVersionId}`, sourceSha256: 'a'.repeat(64), sourceByteLength: 10 };
  const unit = { unitId: `U-${documentVersionId}`, kind: 'paragraph' as const, moduleId: 'body', parentUnitId: null, order: 0, depth: 0, continuityKey: 'body', sourceRefIds: [`SR-${documentVersionId}`], sourceSegmentIds: [], mapping: {}, payload: { text } };
  const selection = { binding, semanticRevision: 1, profileRef: 'fixture', sectionId: `SEC-${documentVersionId}`, ancestorSectionIds: [], organizationWarnings: [], contextUnitIds: [], unitIds: [unit.unitId], sourceRefIds: unit.sourceRefIds, unresolvedRanges: [] };
  return { binding, semanticRevision: 1, profileRef: 'fixture', sections: [{ sectionId: selection.sectionId, headingUnitId: unit.unitId, parentSectionId: null, titleRaw: 'Milestones', roleKey: 'ftd.milestones', occurrence: 1, bodyUnitIds: [unit.unitId], sourceRefIds: unit.sourceRefIds, contentState: 'CONTENT', emptyLiteral: null, mappingSource: 'PROFILE_RULE' }], publisherRevisionDescriptions: [{ selection, units: [unit], sourceLocators: [] }], selectedSections: [{ selection, units: [unit], sourceLocators: [] }], coverage: { knownPageCount: 1, readPageIndexes: [0], unresolvedRanges: [] }, unselectedUnitIds: [] };
}

function reading(status: 'TEXT_EQUAL' | 'TEXT_DIFFERENT'): DocumentRevisionReadingResponse {
  return { familyId: 'F1', before: side('DV-BEFORE', '预计第四季度。'), after: side('DV-AFTER', status === 'TEXT_EQUAL' ? '预计第四季度。' : '当前待定。'), systemComparison: { roleKey: 'ftd.milestones', status, method: 'PLAIN_TEXT_WITH_PARENT_CONTEXT', reasons: [] }, publicationRelationship: 'NOT_VERIFIED', assessmentCoverage: 'NOT_RECORDED_BY_THIS_READ' };
}

describe('document revision reading view', () => {
  it('keeps each compared table and its unchanged attached source conditions together', () => {
    const result = reading('TEXT_DIFFERENT');
    for (const [value, note] of [[result.before, 'Before: do not use X.\nExcept B < 12.'],
      [result.after, 'After: only if Y is closed.\nRetain A & B.']] as const) {
      const unit = value.selectedSections[0].units[0];
      unit.kind = 'table';
      unit.payload = { layout: 'grid', caption: `Table ${value.binding.documentVersionId}`, rawText: note,
        rowGroups: [{ rows: [{ rowId: `${unit.unitId}:row`, cells: [{ cellId: `${unit.unitId}:cell`,
          isHeader: true, rowSpan: 2, colSpan: 2, inlineContent: [{ text: 'Limits' }] }] }] }] };
      value.publisherRevisionDescriptions = [];
    }
    const before = structuredClone(result);
    const html = renderToStaticMarkup(createElement(MemoryRouter, null,
      createElement(DocumentRevisionReadingView, { reading: result })));
    expect(html.match(/原文附带文字/g)).toHaveLength(2);
    expect(html.match(/Before: do not use X[.]/g)).toHaveLength(1);
    expect(html.match(/After: only if Y is closed[.]/g)).toHaveLength(1);
    expect(html).toContain('Before: do not use X.\nExcept B &lt; 12.');
    expect(html).toContain('After: only if Y is closed.\nRetain A &amp; B.');
    expect(html.indexOf('Table DV-BEFORE')).toBeLessThan(html.indexOf('Before: do not use X.'));
    expect(html.indexOf('Before: do not use X.')).toBeLessThan(html.indexOf('Table DV-AFTER'));
    expect(html).toMatch(/rowspan="2"/i);
    expect(html).toMatch(/colspan="2"/i);
    expect(result).toEqual(before);
  });

  it('keeps a text difference bounded instead of declaring the rest unchanged', () => {
    const html = renderToStaticMarkup(createElement(MemoryRouter, null, createElement(DocumentRevisionReadingView, { reading: reading('TEXT_DIFFERENT') })));
    expect(html).toContain('本版修订说明与对应原文差异');
    expect(html).toContain('当前读取没有返回可独立确认的未变段落范围');
    expect(html).not.toContain('<p>其余内容均未变</p>');
    expect(html).toContain('NOT_VERIFIED');
    expect(html).toContain('NOT_RECORDED_BY_THIS_READ');
  });

  it('limits an equal comparison to the selected plain-text scope', () => {
    const html = renderToStaticMarkup(createElement(MemoryRouter, null, createElement(DocumentRevisionReadingView, { reading: reading('TEXT_EQUAL') })));
    expect(html).toContain('所选角色按当前纯文本与父级条件口径一致');
    expect(html).toContain('不覆盖未选择单元、表格、图示或工程含义');
    expect(html).toContain('DV-BEFORE');
    expect(html).toContain('DV-AFTER');
  });
});

it('deduplicates only each table’s exact leading caption while preserving side-specific conditions and source links', () => {
  const result = reading('TEXT_DIFFERENT');
  for (const side of [result.before, result.after]) {
    const unit = side.selectedSections[0].units[0];
    const caption = `Limits ${side.binding.documentVersionId}`;
    unit.kind = 'table';
    unit.payload = { caption, rawText: `${caption}\nDo not use ${side.binding.documentVersionId} unless A < B.`,
      rowGroups: [{ rows: [{ rowId: `${unit.unitId}:row`, cells: [{ cellId: `${unit.unitId}:cell`,
        rowSpan: 1, colSpan: 1, inlineContent: [{ text: 'Value' }] }] }] }] };
    side.publisherRevisionDescriptions = [];
  }
  const before = structuredClone(result);
  const html = renderToStaticMarkup(createElement(MemoryRouter, null,
    createElement(DocumentRevisionReadingView, { reading: result })));
  for (const side of [result.before, result.after]) {
    const dv = side.binding.documentVersionId;
    expect(html.match(new RegExp(`Limits ${dv}`, 'g'))).toHaveLength(1);
    expect(html).toContain(`Do not use ${dv} unless A &lt; B.`);
    for (const ref of side.selectedSections[0].units[0].sourceRefIds) expect(html).toContain(`原文 ${ref}`);
  }
  expect(html.match(/原文附带文字/g)).toHaveLength(2);
  expect(result).toEqual(before);
});
