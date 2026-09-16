import {
  buildRingArrows,
  formatAsof,
  nodePositionPercent,
  recentEvents,
  ringPoint,
  scopeKnowledge,
  scopeMatters,
  situationMetrics,
  stageAnchor,
  stageAssociationCount,
  stageLabel,
  toggleSelection,
  TRINITY_RING,
} from '../../client/src/features/trinity/trinity-model';
import { TRINITY_SAMPLE_FIXTURE } from '../../client/src/features/trinity/trinity-fixture';

describe('Trinity ring geometry', () => {
  it('locks the viewBox, center and ring radii from the design contract', () => {
    expect(TRINITY_RING.viewWidth).toBe(1000);
    expect(TRINITY_RING.viewHeight).toBe(610);
    expect(TRINITY_RING.cx).toBe(500);
    expect(TRINITY_RING.cy).toBe(305);
    expect(TRINITY_RING.outerRx).toBe(378);
    expect(TRINITY_RING.outerRy).toBe(234);
    expect(TRINITY_RING.innerRx).toBe(210);
    expect(TRINITY_RING.innerRy).toBe(136);
    expect(TRINITY_RING.stageStepDeg).toBe(45);
    expect(TRINITY_RING.knowledgeStepDeg).toBe(60);
    expect(TRINITY_RING.outerArrowOffsetDeg).toBe(24);
    expect(TRINITY_RING.knowledgeArrowOffsetDeg).toBe(32);
  });

  it('positions anchors on the ellipse and converts to percent coordinates', () => {
    expect(ringPoint(378, 234, -90)).toEqual({ x: 500, y: 71 });
    expect(ringPoint(378, 234, 0)).toEqual({ x: 878, y: 305 });
    expect(stageAnchor(0)).toEqual({ x: 500, y: 71 });
    const pos = nodePositionPercent(stageAnchor(0));
    expect(pos.left).toBe('50%');
    expect(pos.top).toBe('11.64%');
  });

  it('builds 14 arrows: 8 business and 6 knowledge', () => {
    const arrows = buildRingArrows();
    expect(arrows).toHaveLength(14);
    expect(arrows.filter((a) => a.kind === 'business')).toHaveLength(8);
    expect(arrows.filter((a) => a.kind === 'knowledge')).toHaveLength(6);
    for (const arrow of arrows) {
      expect(arrow.transform).toMatch(/^translate\(-?\d+(\.\d+)? -?\d+(\.\d+)?\) rotate\(-?\d+(\.\d+)?\)$/);
    }
  });
});

describe('Trinity selection semantics', () => {
  it('toggles a repeated stage click to cancel the selection', () => {
    expect(toggleSelection('', 'track')).toBe('track');
    expect(toggleSelection('track', 'track')).toBe('');
    expect(toggleSelection('track', 'verify')).toBe('verify');
  });
});

describe('Trinity scope and metrics', () => {
  const data = TRINITY_SAMPLE_FIXTURE;

  it('keeps deduplicated totals and per-stage association counts separate', () => {
    const all = scopeMatters(data, 'macro', 'all', 'm1');
    expect(all).toHaveLength(16);
    expect(stageAssociationCount(all, 'track')).toBe(4);
    expect(stageAssociationCount(all, 'verify')).toBe(3);
    const fleet777 = scopeMatters(data, 'macro', '777', 'm1');
    expect(fleet777).toHaveLength(5);
    const focus = scopeMatters(data, 'focus', 'all', 'm1');
    expect(focus).toHaveLength(1);
    expect(focus[0].id).toBe('m1');
  });

  it('never fabricates totals or stage status without data', () => {
    expect(situationMetrics(null, null)).toEqual({
      visibleMatters: null,
      attention: null,
      knowledgeWorks: null,
      effectWatch: null,
    });
    expect(stageLabel(null, 'macro', 'track', false)).toBe('阶段关联未取得');
    expect(stageLabel([], 'focus', 'track', false)).toBe('无当前阶段记录');
    expect(stageLabel([], 'focus', 'track', true)).toBe('当前有工作在此环节');
  });

  it('computes metrics from the scoped records only', () => {
    const scope = scopeMatters(data, 'macro', 'all', 'm1');
    expect(situationMetrics(data, scope)).toEqual({
      visibleMatters: 16,
      attention: 6,
      knowledgeWorks: 6,
      effectWatch: 3,
    });
  });

  it('lists recent events within the asOf cutoff in descending order', () => {
    const scope = scopeMatters(data, 'macro', 'all', 'm1');
    const events = recentEvents(data, scope, data.meta.asOf);
    expect(events.map((e) => e.id)).toEqual(['e9', 'e8', 'e7']);
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
    expect(data.stages).toHaveLength(8);
    expect(data.knowledgeStages).toHaveLength(6);
    expect(data.matters.length).toBeGreaterThan(0);
    for (const k of data.knowledgeStages) {
      expect(k.purpose.length).toBeGreaterThan(0);
    }
  });
});
