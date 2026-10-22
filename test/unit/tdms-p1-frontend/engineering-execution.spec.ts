import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { StaticRouter } from 'react-router-dom/server';
import type { TdmsFileServiceRecordReadResponse } from '@shared/tdms-file-service-import.interface';
import { TdmsRecordDetails } from '@client/src/features/tdms-source/TdmsRecordDetails';
import { TdmsEngineeringExecution } from '@client/src/features/tdms-source/TdmsEngineeringExecution';
import { sourceRead } from './fixtures';

function reading(): TdmsFileServiceRecordReadResponse {
  const read = sourceRead('engineering-1');
  read.record.recordKind = 'ENGINEERING_FILE';
  read.record.fileType = { rawCode: null, rawName: 'AEO' };
  read.record.content = {};
  read.record.capturedAt = '2026-10-15T00:00:00.000Z';
  read.receipt.readAt = '2026-10-22T00:00:00.000Z';
  read.bodyReadPolicy!.kind = 'NON_OPINION_SOURCE';
  read.engineeringExecution = {
    sourceRevisionRef: read.record.sourceRevisionRef, sourceRecordId: read.record.sourceRecordId,
    sourceVersion: read.record.sourceVersion, businessVersion: read.record.businessVersion ?? null,
    requirementCoverage: 'NOT_CAPTURED', targetAircraftCoverage: 'UNKNOWN', executionVerified: false,
    windows: [{ tableId: 'status-window', tableTitle: 'Related Status', sourceLocator: '#status',
      observedAt: '2026-10-13T00:00:00.000Z', enumerationState: 'VALUE', stopReason: null,
      reportedRowCount: 2, observedAircraftCount: 1, sourceViewEvidence: null,
      rows: [0, 1].map((index: number) => ({ sourceRecordId: `status-${index}`, number: `Status ${index}`,
        stateRaw: index === 0 ? 'Completed' : 'Not completed', sourceModifiedRaw: '2026-10-12 09:00',
        executionStatus: { engineeringDocumentRef: read.record.sourceRecordId, engineeringDocumentNumber: 'AEO-TEST',
          assetRef: 'aircraft-1', assetNumber: 'SYNTHETIC-AIRCRAFT', feedbackRef: index === 0 ? 'feedback-1' : null,
          feedbackNumber: index === 0 ? 'Feedback 1' : null, executedDateRaw: index === 0 ? 'TBD' : null,
          expiredDateRaw: '2027-01-01', stateComments: 'Feedback received 2026-10-12; planned 2026-11-01',
          operatorBase: 'Synthetic base' } })),
    }],
  };
  return read;
}
const render = (read: TdmsFileServiceRecordReadResponse): string => renderToStaticMarkup(
  createElement(StaticRouter, null, createElement(TdmsRecordDetails, { read })),
);

describe('engineering execution source reading in the existing record detail consumer', () => {
  it('renders exact source rows, identities and separate dates without calculating completion', () => {
    const html = render(reading());
    expect(html).toContain('公司工程文件单机执行反馈');
    expect(html).toContain('已读 2 条来源行 · 已知 1 个飞机原生身份');
    for (const value of ['Completed', 'Not completed', 'TBD', 'status-0', 'status-1', 'feedback-1',
      'Feedback received 2026-10-12; planned 2026-11-01', '2027-01-01', '2026-10-12 09:00',
      '2026-10-13T00:00:00.000Z', '2026-10-15T00:00:00.000Z', '2026-10-22T00:00:00.000Z']) {
      expect(html).toContain(value);
    }
    expect(html).toContain('未取得反馈单关联');
    expect(html).toContain('反馈单正文未由此读取');
    expect(html).toContain('反馈日期、计划日期未作为独立字段取得');
    expect(html).toContain('逐项执行要求和完整目标机队尚未取得');
    expect(html).toContain('原生视图与筛选依据未取得');
    expect(html).not.toMatch(/\d+\s*%/u);
  });
  it('does not turn an empty source window into an empty target fleet or completed AEO', () => {
    const read = reading();
    Object.assign(read.engineeringExecution!.windows[0], { rows: [], reportedRowCount: 0, observedAircraftCount: 0 });
    const html = render(read);
    expect(html).toContain('本来源窗口没有单机状态行；不据此认定目标机队为空或全部完成');
    expect(html).toContain('已读 0 条来源行 · 已知 0 个飞机原生身份');
  });
  it('keeps unavailable structured rows explicit and refuses a different revision', () => {
    const read = reading();
    read.engineeringExecution!.sourceRevisionRef = 'another-revision';
    expect(render(read)).toContain('单机执行反馈与当前来源修订不一致');
    expect(render(read)).not.toContain('SYNTHETIC-AIRCRAFT');
    delete read.engineeringExecution;
    expect(render(read)).toContain('结构化单机执行反馈尚未取得');
  });
  it('does not access the projection after body permission is missing or mismatched', () => {
    const read = reading();
    const getter = jest.fn(() => { throw new Error('must not read execution'); });
    Object.defineProperty(read, 'engineeringExecution', { get: getter });
    delete read.bodyReadPolicy;
    expect(renderToStaticMarkup(createElement(TdmsEngineeringExecution, { read }))).toBe('');
    render(read);
    read.bodyReadPolicy = { kind: 'NON_OPINION_SOURCE', sourceRecordId: read.record.sourceRecordId,
      sourceRevisionRef: 'another' };
    render(read);
    expect(getter).not.toHaveBeenCalled();
  });
});
