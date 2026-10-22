import type { VerificationSnapshot, WiseLinkMonitorElement } from '../../client/src/pages/DocumentParsingPage/runtime-monitor/monitor-types';
const { JSDOM } = require('jsdom');
const dom = new JSDOM('<!doctype html><body></body>', { pretendToBeVisual: true });
dom.window.scrollTo = () => undefined;
const prior = new Map<string, PropertyDescriptor | undefined>();
for (const [name, value] of Object.entries({
  window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement,
  customElements: dom.window.customElements, CustomEvent: dom.window.CustomEvent,
  requestAnimationFrame: dom.window.requestAnimationFrame, cancelAnimationFrame: dom.window.cancelAnimationFrame,
  ResizeObserver: class { observe() {} disconnect() {} },
})) {
  prior.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
  Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
}
require('../../client/src/pages/DocumentParsingPage/runtime-monitor/wiselink-monitor.js');
const contractRevision = 'a'.repeat(64);
function snapshot(): VerificationSnapshot {
  return {
    formatVersion: 1,
    snapshot: { dataMode: 'snapshot', generatedAt: '2026-10-22T15:00:00Z',
      contract: { version: 'v1.6', source: 'contract.md', sourceRevision: contractRevision, sourceRevisionType: 'sha256' },
      target: { sourceRevision: 'candidate-new', environmentId: 'isolated-test' },
      workPackages: [{ id: 'P0', label: '保存闭环', bindingIds: ['save.finish'], scenarioIds: ['V01'], nextAction: '核对终态读回' },
        { id: 'P1', label: '综合消费', bindingIds: ['research.overall'] }],
    },
    catalog: { nodes: [{ id: 'assessment.research', label: '调查' }, { id: 'assessment.overall', label: '综合' }],
      edges: [{ id: 'research.overall', label: '工作到综合' }],
      scenarios: [{ id: 'V01', label: '恢复', bindingIds: ['save.finish'] }, { id: 'V02', label: '实际消费', bindingIds: ['research.overall'] }],
      rules: [{ id: 'R01' }],
    },
    bindings: [
      { id: 'save.finish', label: '保存并收尾', nodeIds: ['assessment.research'], edgeIds: [], consistencyScenarioIds: ['V01'], workPackageIds: ['P0'],
        sourceRevision: 'candidate-new', consumer: 'save.service.ts:finish', executionOwner: 'worker.ts:resume', decisionEntry: 'save.ts:check', projectionEntry: 'save.ts:write', readEntry: 'read.ts:get',
        authority: { requestRecord: 'attempt', artifactRecord: 'work', consumedInputField: 'basedOn' },
        gaps: [{ id: 'runtime-save', kind: 'runtime', reason: '当前候选尚无真实终态读回', nextAction: '读取原请求的准确保存结果' }] },
      { id: 'research.overall', label: '工作实际进入综合', nodeIds: ['assessment.research', 'assessment.overall'], edgeIds: ['research.overall'], consistencyScenarioIds: ['V02'], gaps: [{ id: 'test-overall', kind: 'test', reason: '缺内容消费验收', nextAction: '执行准确输入验证' }] },
    ],
    selection: { changedNodeIds: ['assessment.research'], changedEdgeIds: [], scenarioIds: ['V01', 'V02'], reason: '定向验证' },
    evidence: [
      { id: 'source-save', kind: 'source_review', status: 'passed', contractRevision, sourceRevision: 'candidate-new', observedAt: '2026-10-22T12:00:00Z', reportRef: 'review.md', bindingIds: ['save.finish'] },
      { id: 'test-save', kind: 'test', testLevel: 'unit', status: 'passed', contractRevision, sourceRevision: 'candidate-new', observedAt: '2026-10-22T12:01:00Z', reportRef: 'test.log', bindingIds: ['save.finish'], scenarioIds: ['V01'] },
      { id: 'historical-runtime', kind: 'runtime', status: 'passed', contractRevision, sourceRevision: 'host-old', environmentId: 'production', observedAt: '2026-10-21T10:00:00Z', reportRef: 'historical.json', bindingIds: ['save.finish'], subjectRef: 'WI-1', requestRef: 'REQ-1', readbackRef: 'READ-1', inputRefs: ['INPUT-1'], outputRefs: ['WORK-1'] },
    ],
  };
}
let monitor: WiseLinkMonitorElement;
function root(): ShadowRoot { return monitor.shadowRoot!; }
function text(): string { return root().textContent ?? ''; }
function choose(id: string, value: string): void {
  const control = root().querySelector<HTMLSelectElement>(`#${id}`)!;
  control.value = value; control.dispatchEvent(new dom.window.Event('change'));
}
function click(selector: string): void { root().querySelector<HTMLButtonElement>(selector)!.click(); }
function rows(): string[] { return Array.from(root().querySelectorAll('tbody tr')).map(row => row.textContent ?? ''); }
beforeEach(() => {
  monitor = document.createElement('wiselink-monitor') as WiseLinkMonitorElement;
  document.body.append(monitor);
  monitor.updateInputs({ verification: snapshot(), allowVerification: true, view: 'verification' });
});
afterEach(() => monitor.remove());
afterAll(() => {
  for (const [name, value] of prior) { if (value) Object.defineProperty(globalThis, name, value); else Reflect.deleteProperty(globalThis, name); }
  dom.window.close();
});
it('separates source, test, deployment and historical runtime and shows both observation and generation metadata', () => {
  const save = rows()[0];
  expect(save).toContain('源码范围匹配 · 通过记录');
  expect(save).toContain('测试范围匹配 · 通过记录');
  expect(save).toContain('未记录');
  expect(save).toContain('历史 / 示例证据');
  expect(text()).toContain('candidate-new'); expect(text()).toContain('isolated-test');
  expect(text()).toContain('2026-10-22T15:00:00Z'); expect(text()).toContain('2026-10-21T10:00:00Z');
  expect(text()).toContain('历史 / 范围未匹配；不证明当前候选通过');
  expect(text()).toContain('host-old'); expect(text()).toContain('production');
});
it('filters the edge-less save.finish binding and intersects package, scenario and gap without changing selection', () => {
  const selection = JSON.stringify(monitor.verification!.selection);
  choose('chain-filter', 'binding:save.finish');
  expect(rows()).toHaveLength(1); expect(rows()[0]).toContain('save.finish');
  choose('work-package-filter', 'P0'); choose('scenario-filter', 'V01'); choose('gap-filter', 'runtime');
  expect(rows()).toHaveLength(1);
  choose('gap-filter', 'test'); expect(rows()).toHaveLength(0);
  expect(JSON.stringify(monitor.verification!.selection)).toBe(selection);
  choose('gap-filter', ''); choose('scenario-filter', ''); choose('work-package-filter', '');
  choose('chain-filter', 'edge:research.overall');
  expect(rows()).toHaveLength(1); expect(rows()[0]).toContain('research.overall');
});
it('drills node and edge relations into exact binding entries, evidence and next steps without inheriting passing status', () => {
  click('[data-category="node"]');
  expect(rows()[0]).not.toContain('通过记录');
  expect(root().querySelectorAll('[data-binding-detail]')).toHaveLength(2);
  click('[data-binding-detail="save.finish"]');
  expect(text()).toContain('save.service.ts:finish'); expect(text()).toContain('worker.ts:resume');
  expect(text()).toContain('当前候选尚无真实终态读回'); expect(text()).toContain('读取原请求的准确保存结果');
  expect(text()).toContain('核对终态读回'); expect(text()).toContain('historical.json');
  click('[data-category="edge"]');
  expect(root().querySelector('[data-binding-detail="research.overall"]')).not.toBeNull();
  click('[data-binding-detail="research.overall"]');
  expect(text()).toContain('执行准确输入验证');
});
it('retains filters only for the same target and supports legacy snapshots without optional metadata', () => {
  choose('work-package-filter', 'P0');
  monitor.verification = { ...snapshot(), snapshot: { ...snapshot().snapshot, generatedAt: '2026-10-22T16:00:00Z' } };
  expect(root().querySelector<HTMLSelectElement>('#work-package-filter')!.value).toBe('P0');
  const legacy = snapshot(); delete legacy.snapshot.workPackages;
  legacy.bindings.forEach(binding => { delete binding.workPackageIds; delete binding.gaps; });
  legacy.snapshot.target.sourceRevision = 'other-candidate'; monitor.verification = legacy;
  expect(root().querySelector<HTMLSelectElement>('#work-package-filter')!.value).toBe('');
  expect(rows()).toHaveLength(2); expect(rows()[0]).not.toContain('通过记录');
  expect(text()).toContain('未记录缺口说明；不能据此判断完成');
});
it('rejects dangling work packages and malformed gap metadata visibly, escaping valid gap content', () => {
  const invalid = snapshot(); invalid.bindings[0].workPackageIds = ['missing'];
  monitor.verification = invalid;
  expect(text()).toContain('workPackageIds 包含无效或悬空引用');
  expect(monitor.verification!.bindings[0].workPackageIds).toEqual(['P0']);
  const badGap = snapshot(); badGap.bindings[0].gaps![0].reason = '';
  monitor.verification = badGap; expect(text()).toContain('缺口格式无效');
  const safe = snapshot(); safe.bindings[0].gaps![0].reason = '<img src=x onerror=alert(1)>';
  monitor.verification = safe;
  expect(root().querySelector('img')).toBeNull(); expect(text()).toContain('<img src=x onerror=alert(1)>');
});

it('shows an escaped evidence scope summary without expanding complete JSON', () => {
  const data = snapshot();
  data.evidence[0].summary = '只覆盖读取入口；继承说明 <script>不可升格旧运行</script>';
  monitor.verification = data;
  const summary = root().querySelector('.evidence-summary');
  expect(summary?.textContent).toBe(data.evidence[0].summary);
  expect(summary?.closest('details')).toBeNull();
  expect(summary?.querySelector('script')).toBeNull();
});
it('labels matching not_run by column and keeps inconclusive distinct from failures', () => {
  const data = snapshot();
  data.evidence = (['source_review', 'test', 'deployment', 'runtime'] as const).map(kind => ({
    id: kind, kind, status: 'not_run', sourceRevision: 'candidate-new', contractRevision,
    environmentId: 'isolated-test', bindingIds: ['save.finish'], scenarioIds: ['V01'],
  }));
  monitor.verification = data;
  expect(rows()[0]).toContain('尚未部署');
  expect(rows()[0]).toContain('尚未核对真实运行');
  expect(rows()[0].match(/尚未执行/g)).toHaveLength(2);
  data.evidence[3].status = 'inconclusive'; monitor.verification = data;
  expect(rows()[0]).toContain('证据未定论');
  expect(rows()[0]).not.toContain('存在失败');
  data.evidence[3].sourceRevision = 'old'; monitor.verification = data;
  expect(rows()[0]).toContain('历史 / 示例证据');
});
