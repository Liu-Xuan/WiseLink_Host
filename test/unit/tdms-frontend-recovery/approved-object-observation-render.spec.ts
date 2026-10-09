import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import type { TdmsFileServiceRecordReadResponse } from '../../../shared/tdms-file-service-import.interface';
import { TdmsRecordDetails } from '@client/src/features/tdms-source/TdmsRecordDetails';
import { record } from './reader-fixtures';

function render(read: TdmsFileServiceRecordReadResponse): string {
  return renderToStaticMarkup(
    createElement(
      MemoryRouter,
      null,
      createElement(TdmsRecordDetails, { read }),
    ),
  );
}

function approvedObservation(): TdmsFileServiceRecordReadResponse {
  const read = record('estimated-object');
  read.record.state = { rawCode: 'Estimated', rawName: 'Estimated' };
  read.record.sourceVersion = {
    rawRevision: null,
    rawIteration: null,
    confirmation: 'VERSION_UNCONFIRMED',
  };
  read.record.sourceModifiedAt = null;
  read.record.coverage = {
    status: 'PARTIAL',
    readback: 'NON_ATOMIC',
    gaps: ['TECHNICAL_VERSION_UNEXPOSED'],
  };
  read.record.rawFields = {
    sourceModifiedRaw: '2026-09-22 11:35CST',
    opinionCollection: {
      schemaVersion: 'wiselink.tdms-opinion-collection.v1',
      mode: 'ESTIMATED_OPINION',
      reason: 'APPROVED_CURRENT_OBJECT_OBSERVATION',
    },
  };
  return read;
}

describe('TDMS approved current-object observation label', () => {
  it('qualifies the visible source state beside identity and time without inventing a technical version', () => {
    const read = approvedObservation();
    const before = JSON.stringify(read);
    const html = render(read);

    expect(html).toContain('原生记录 source-estimated-object');
    expect(html).toContain(
      '批准状态来自本次页面观察；技术版本未确认，页面为分步读取。',
    );
    expect(html).toContain('源版本未确认');
    expect(html).toContain(
      '源修改时间（原始显示）</dt><dd>2026-09-22 11:35CST</dd>',
    );
    expect(html).toContain('源修改时间</dt><dd>未取得</dd>');
    expect(html).toContain('不据此推定发布方当前有效版本');
    expect(html).not.toContain('TDMS 技术对象版次');
    expect(html).not.toContain('已正式采用');
    expect(html).not.toContain('已执行工程');
    expect(JSON.stringify(read)).toBe(before);
  });

  it.each([
    null,
    {
      schemaVersion: 'wiselink.tdms-opinion-collection.v1',
      mode: 'METADATA_ONLY',
      reason: 'APPROVED_CURRENT_OBJECT_OBSERVATION',
    },
    {
      schemaVersion: 'wiselink.tdms-opinion-collection.v1',
      mode: 'ESTIMATED_OPINION',
      reason: 'APPROVED_CURRENT_EXACT_VERSION',
    },
    {
      schemaVersion: 'other',
      mode: 'ESTIMATED_OPINION',
      reason: 'APPROVED_CURRENT_OBJECT_OBSERVATION',
    },
  ])(
    'does not apply the observation qualifier to other collection metadata',
    (opinionCollection) => {
      const read = approvedObservation();
      read.record.rawFields.opinionCollection = opinionCollection;
      expect(render(read)).not.toContain('批准状态来自本次页面观察');
    },
  );
});
