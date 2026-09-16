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
