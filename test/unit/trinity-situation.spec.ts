import {
  formatAsof,
  nodePositionPercent,
  recentEvents,
  ringPoint,
  scopeKnowledge,
  scopeMatters,
  situationMetrics,
  stageAnchor,
  sourceAnchor,
  stageAssociationCount,
  stageLabel,
  toggleSelection,
  TRINITY_RING,
} from '../../client/src/features/trinity/trinity-model';
import { TRINITY_SAMPLE_FIXTURE } from '../../client/src/features/trinity/trinity-fixture';

describe('Trinity ring geometry', () => {
  it('locks the viewBox, center and ring radii from the design contract', () => {
    expect(TRINITY_RING.viewWidth).toBe(1100);
    expect(TRINITY_RING.viewHeight).toBe(660);
    expect(TRINITY_RING.cx).toBe(550);
    expect(TRINITY_RING.cy).toBe(330);
    expect(TRINITY_RING.outerRx).toBe(465);
    expect(TRINITY_RING.outerRy).toBe(257);
    expect(TRINITY_RING.innerRx).toBe(253);
    expect(TRINITY_RING.innerRy).toBe(154);
    expect(TRINITY_RING.stageStepDeg).toBe(60);
    expect(TRINITY_RING.sourceStepDeg).toBe(60);
  });

  it('positions anchors on the ellipse and converts to percent coordinates', () => {
    expect(ringPoint(465, 257, -90)).toEqual({ x: 550, y: 73 });
    expect(ringPoint(465, 257, 0)).toEqual({ x: 1015, y: 330 });
    expect(stageAnchor(0)).toEqual({ x: 550, y: 73 });
    expect(sourceAnchor(0)).toEqual({ x: 550, y: 176 });
    const pos = nodePositionPercent(stageAnchor(0));
    expect(pos.left).toBe('50%');
    expect(pos.top).toBe('11.06%');
  });

});

describe('Trinity selection semantics', () => {
  it('toggles a repeated stage click to cancel the selection', () => {
    expect(toggleSelection('', 'conditions')).toBe('conditions');
    expect(toggleSelection('conditions', 'conditions')).toBe('');
    expect(toggleSelection('conditions', 'analysis')).toBe('analysis');
  });
});

describe('Trinity scope and metrics', () => {
  const data = TRINITY_SAMPLE_FIXTURE;

  it('keeps deduplicated totals and per-stage association counts separate', () => {
    const all = scopeMatters(data, 'macro', 'all', 'm1');
    expect(all).toHaveLength(6);
    expect(stageAssociationCount(all, 'question')).toBe(5);
    expect(stageAssociationCount(all, 'synthesis')).toBe(4);
    const fleet777 = scopeMatters(data, 'macro', '777', 'm1');
    expect(fleet777).toHaveLength(3);
    const focus = scopeMatters(data, 'focus', 'all', 'm1');
    expect(focus).toHaveLength(1);
    expect(focus[0].id).toBe('m1');
  });

  it('never fabricates totals or stage status without data', () => {
    expect(situationMetrics(null, null)).toEqual({
      visibleMatters: null,
      sourceCount: null,
      attention: null,
      synthesisPending: null,
    });
    expect(stageLabel(null, 'macro', 'conditions', false)).toBe('评估关联未取得');
    expect(stageLabel([], 'focus', 'conditions', false)).toBe('尚未取得相关工作');
    expect(stageLabel([], 'focus', 'conditions', true)).toBe('已有相关工作');
  });

  it('computes metrics from the scoped records only', () => {
    const scope = scopeMatters(data, 'macro', 'all', 'm1');
    expect(situationMetrics(data, scope)).toEqual({
      visibleMatters: 6,
      sourceCount: 9,
      attention: 5,
      synthesisPending: 3,
    });
  });

  it('lists recent events within the asOf cutoff in descending order', () => {
    const scope = scopeMatters(data, 'macro', 'all', 'm1');
    const events = recentEvents(data, scope, data.meta.asOf);
    expect(events.map((e) => e.id)).toEqual(['e1']);
    for (const e of events) {
      expect(e.date).not.toBeNull();
      expect((e.date ?? '') <= data.meta.asOf).toBe(true);
    }
  });

  it('scopes knowledge through matter ownership or registered reuse', () => {
    const focus = scopeMatters(data, 'focus', 'all', 'm1');
    const items = scopeKnowledge(data, focus);
    expect(items.length).toBeGreaterThan(0);
    for (const k of items) {
      expect(k.matter === 'm1' || k.reuse.includes('m1')).toBe(true);
    }
  });

  it('formats the asOf line per level', () => {
    const focusMatter = data.matters[0];
    expect(formatAsof(data, 'macro', null)).toContain('示例资料截至 2026-09-16');
    expect(formatAsof(data, 'focus', focusMatter)).toContain('777 / ATA 31');
  });
});

describe('Trinity fixture contract', () => {
  it('keeps the isolated sample marked and structurally complete', () => {
    const data = TRINITY_SAMPLE_FIXTURE;
    expect(data.meta.origin).toBe('ISOLATED_EXAMPLE');
    expect(data.stages).toHaveLength(6);
    expect(data.sourceCategories).toHaveLength(6);
    expect(data.matters.length).toBeGreaterThan(0);
    for (const k of data.sourceCategories) {
      expect(k.purpose.length).toBeGreaterThan(0);
    }
  });
});
