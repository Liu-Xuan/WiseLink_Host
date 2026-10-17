import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { LcmSnapshotFacts, LcmSnapshotRecords } from '@client/src/pages/WorkspaceHomePage/LcmSnapshotRecords';
import { lcmRecordPresentation, lcmSnapshotTimeFacts } from '@client/src/pages/WorkspaceHomePage/lcm-source-presentation';
import { configurationRecord, snapshot } from './fixtures';

describe('LCM candidate snapshot source reading', () => {
  it('keeps allowed, installed and newly effective separate and preserves unknowns', () => {
    const record = configurationRecord();
    expect(lcmRecordPresentation(record)).toMatchObject({ allowed: '是', installed: '否', newlyEffective: '未知',
      effectiveAt: '未知', executedAt: '未知', rawState: 'source-raw-state' });
    record.installed = null;
    record.allowed = null;
    record.tailNumber = '';
    const html = renderToStaticMarkup(createElement(LcmSnapshotRecords, { records: [record] }));
    expect(html).toContain('单机身份未取得');
    expect(html).toContain('允装</dt><dd>未知');
    expect(html).toContain('实装</dt><dd>未知');
    expect(html).toContain('新生效</dt><dd>未知');
    expect(html).toContain('AEO-TEST R13');
    expect(html).not.toContain('R13 已执行');
    expect(html).toContain('Sheet0');
    expect(html).toContain('C5');
  });

  it('shows cutoff, observation, export and receipt without turning them into effective time', () => {
    const value = snapshot();
    const facts = lcmSnapshotTimeFacts(value);
    expect(facts).toEqual(expect.arrayContaining([
      { label: '源数据截止日期', value: '2026-10-12' },
      { label: 'Host 接收时间', value: value.importedAt },
      { label: '构型实际生效时间', value: '未知' },
    ]));
    const html = renderToStaticMarkup(createElement(LcmSnapshotFacts, { snapshot: value }));
    expect(html).toContain('时区未核验');
    expect(html).toContain('2 架');
    expect(html).toContain('仅有本地来源引用');
    expect(renderToStaticMarkup(createElement(LcmSnapshotRecords, { records: [] }))).toContain('当前筛选没有匹配记录。');
  });
});
