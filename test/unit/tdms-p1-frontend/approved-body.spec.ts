import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { StaticRouter } from 'react-router-dom/server';
import type { TdmsSourceContent } from '@shared/tdms-source.interface';
import { TdmsRecordDetails } from '@client/src/features/tdms-source/TdmsRecordDetails';
import { tdmsSourceReadForPreview } from '@client/src/features/tdms-source/tdms-assessment-body';
import { canReadTdmsSourceBody } from '@shared/tdms-source-body-policy';
import { sourceRead } from './fixtures';

const DRAFT_MARKER = 'SENSITIVE_UNAPPROVED_DRAFT_MARKER';

function body(): TdmsSourceContent {
  return {
    opinions: [{ text: DRAFT_MARKER, author: null, state: null, conditions: [DRAFT_MARKER],
      requiredActions: [DRAFT_MARKER], sourceSelector: 'opinion-selector' }],
    conditions: [DRAFT_MARKER], requiredActions: [DRAFT_MARKER],
    completeOwnedFields: [{ fieldId: 'opinion', tabId: 'tab', sectionId: 'section',
      labelOrigin: 'NATIVE_SOURCE_DECLARED', nativeControl: { tag: 'TEXTAREA', readOnly: true, disabled: false },
      value: { state: 'VALUE', actualLabel: '意见', rawValue: DRAFT_MARKER,
        locator: 'opinion-selector', observedTotalCodepoints: DRAFT_MARKER.length }, links: [] }],
    boundedOwnedBody: [{ actualLabel: '意见', labelOrigin: 'NATIVE_VISIBLE_LABEL', sectionLabel: '意见',
      panelLocator: 'panel', locator: 'bounded-selector', fieldType: 'DISPLAY_TEXT', presence: 'PRESENT_VALUE',
      rawBoundedValue: DRAFT_MARKER, nativeControl: { tag: 'TD', readOnly: true, disabled: false, visibleControls: [] },
      truncation: { truncated: false, limit: 8000, capturedCodepoints: DRAFT_MARKER.length, observedTotalCodepoints: DRAFT_MARKER.length },
      observedAt: '2026-10-14T00:00:00Z' }],
    ownedVisibleBusinessContent: [{ '意见': DRAFT_MARKER }],
  };
}

describe('per-assessment Estimated body boundary', () => {
  it.each(['Estimating', 'Unapproved', 'Unknown', 'Released', ''])('never accesses draft fields for own state %s', state => {
    const read = sourceRead('unapproved', 'DV-1', state);
    const contentGetter = jest.fn(() => body());
    const rawFieldsGetter = jest.fn(() => ({ opinionCollection: { parentState: 'Estimated' }, draft: DRAFT_MARKER }));
    const artifactsGetter = jest.fn(() => [{ draft: DRAFT_MARKER }]);
    const selectedFieldsGetter = jest.fn(() => [{ draft: DRAFT_MARKER }]);
    Object.defineProperty(read.record, 'content', { get: contentGetter, enumerable: true });
    Object.defineProperty(read.record, 'rawFields', { get: rawFieldsGetter, enumerable: true });
    Object.defineProperty(read.record, 'artifacts', { get: artifactsGetter, enumerable: true });
    Object.defineProperty(read, 'selectedFields', { get: selectedFieldsGetter, enumerable: true });
    const html = renderToStaticMarkup(createElement(StaticRouter, null, createElement(TdmsRecordDetails, { read })));
    const preview = tdmsSourceReadForPreview(read);
    expect(contentGetter).not.toHaveBeenCalled();
    expect(rawFieldsGetter).not.toHaveBeenCalled();
    expect(artifactsGetter).not.toHaveBeenCalled();
    expect(selectedFieldsGetter).not.toHaveBeenCalled();
    expect(html).toContain('本条仅显示元数据；评估意见须本评估单批准后增量取得');
    expect(html).toContain('TDMS 来源元数据');
    expect(html).toContain('原生记录');
    expect(html).not.toContain('未采集意见正文');
    expect(html).toContain('source-unapproved');
    expect(html).toContain('R00');
    expect(html).not.toContain(DRAFT_MARKER);
    expect(JSON.stringify(preview)).not.toContain(DRAFT_MARKER);
    expect(preview.record.content).toEqual({});
    expect(preview.record.rawFields).toEqual({});
  });

  it('shows uncertain read admission for Estimated without policy and never accesses its body', () => {
    const read = sourceRead('no-policy');
    delete read.bodyReadPolicy;
    const getter = jest.fn(() => body());
    Object.defineProperty(read.record, 'content', { get: getter, enumerable: true });
    const html = renderToStaticMarkup(createElement(StaticRouter, null, createElement(TdmsRecordDetails, { read })));
    expect(html).toContain('本条正文的读取准入尚未确认，仅显示元数据');
    expect(html).toContain('父处理单或其他专业的批准不能替代');
    expect(getter).not.toHaveBeenCalled();
    expect(html).not.toContain(DRAFT_MARKER);
    expect(JSON.stringify(tdmsSourceReadForPreview(read))).not.toContain(DRAFT_MARKER);
  });

  it('keeps two approved professions, but does not let one approve a sibling or a historical draft', () => {
    const approved = sourceRead('profession-approved');
    const sibling = sourceRead('profession-draft', 'DV-1', 'Estimating');
    approved.record.content.opinions![0].text = '合法已批准专业意见';
    sibling.record.content = body();
    sibling.record.rawFields = { processingState: 'Estimated', anotherProfessionState: 'Estimated', draft: DRAFT_MARKER };
    const html = renderToStaticMarkup(createElement(StaticRouter, null, createElement('section', null,
      createElement(TdmsRecordDetails, { read: approved }), createElement(TdmsRecordDetails, { read: sibling }))));
    expect(html).toContain('合法已批准专业意见');
    expect(html).toContain('source-profession-draft');
    expect(html).not.toContain(DRAFT_MARKER);
    sibling.record.selectedHead = false;
    expect(canReadTdmsSourceBody(sibling)).toBe(false);
    sibling.record.state = { rawCode: 'Estimating', rawName: 'Estimated' };
    expect(canReadTdmsSourceBody(sibling)).toBe(false);
  });

  it.each(['COMMENT', 'PROCESSING_SHEET', 'OBSERVATION'] as const)('does not exempt an unapproved opinion under coarse kind %s', recordKind => {
    const read = sourceRead('coarse-kind', 'DV-1', 'Estimating');
    read.record.recordKind = recordKind;
    read.record.fileType = { rawCode: null, rawName: '工程文件编写评估单' };
    const getter = jest.fn(() => body());
    Object.defineProperty(read.record, 'content', { get: getter, enumerable: true });
    const html = renderToStaticMarkup(createElement(StaticRouter, null, createElement(TdmsRecordDetails, { read })));
    expect(canReadTdmsSourceBody(read)).toBe(false);
    expect(getter).not.toHaveBeenCalled();
    expect(html).not.toContain(DRAFT_MARKER);
    expect(JSON.stringify(tdmsSourceReadForPreview(read))).not.toContain(DRAFT_MARKER);
  });
});
