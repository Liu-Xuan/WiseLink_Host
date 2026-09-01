import type { CanonicalLibraryIndexNode } from '../../shared/api.interface';
import {
  buildDocumentTree,
  humanState,
} from '../../client/src/features/navigation/treeMappers';

describe('navigation tree user-facing state semantics', () => {
  it('keeps stale, conflict and obsolete precedence over candidate styling', () => {
    const states = [
      'CANDIDATE_STALE',
      'CANDIDATE_CONFLICT',
      'CANDIDATE_OBSOLETE',
      'CANDIDATE_READY',
      'FORMAL_READBACK_CURRENT',
    ];
    const nodes = buildDocumentTree(states.map(node));

    expect(nodes.map((item) => item.badgeTone)).toEqual([
      'amber',
      'red',
      'muted',
      'accent',
      'green',
    ]);
    expect(nodes.map((item) => item.badge)).toEqual([
      '结论需更新',
      '基于旧版本',
      '已被新版本替代',
      '候选可复核',
      '当前有效',
    ]);
  });

  it('never returns an untranslated internal token to the interface', () => {
    expect(humanState('WAITING_INPUT')).toBe('还需补充资料');
    expect(humanState('UNKNOWN_INTERNAL_GATE')).toBe('状态待确认');
  });
});

function node(state: string, index: number): CanonicalLibraryIndexNode {
  return {
    id: `node-${index}`,
    parentId: null,
    kind: 'OVERALL_SYNTHESIS',
    label: '综合评估意见',
    detail: '当前候选',
    state,
    targetNode: 'process',
    authority: 'HOST_WORKITEM_PROJECTION',
  };
}
