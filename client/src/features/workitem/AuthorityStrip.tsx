import {
  CircleCheck,
  CircleDashed,
  Clock3,
  FileWarning,
  UserCheck,
} from 'lucide-react';

import {
  AUTHORITY_LABELS,
  FRESHNESS_LABELS,
  type WorkItemView,
} from '@client/src/services/viewModelMappers';

import './workitem-overview.css';

/**
 * 权威与时效横条（Spec R01 §7 AuthorityStrip）。
 * 全工作台固定可见：候选 / 当前有效 / 文件版本 / 结论需更新。
 * 颜色权威规则：绿色只用于正式回读确认；琥珀表示需更新；红色表示冲突。
 */
export default function AuthorityStrip({ view }: { view: WorkItemView }) {
  const authorityTone =
    view.authority === 'formal_readback'
      ? 'green'
      : view.authority === 'unavailable'
        ? 'muted'
        : 'accent';
  const freshnessTone =
    view.freshness === 'needs_update'
      ? 'amber'
      : view.freshness === 'superseded'
        ? 'red'
        : 'muted';

  return (
    <div
      className="wl-authority-strip"
      role="status"
      aria-label="候选与有效性状态"
    >
      <span className={`wl-authority-chip is-${authorityTone}`}>
        {view.authority === 'formal_readback' ? (
          <CircleCheck aria-hidden="true" />
        ) : view.authority === 'engineer_confirmed' ? (
          <UserCheck aria-hidden="true" />
        ) : (
          <CircleDashed aria-hidden="true" />
        )}
        {AUTHORITY_LABELS[view.authority]}
      </span>

      <span className={`wl-authority-chip is-${freshnessTone}`}>
        {view.freshness === 'needs_update' ? (
          <FileWarning aria-hidden="true" />
        ) : (
          <Clock3 aria-hidden="true" />
        )}
        {FRESHNESS_LABELS[view.freshness]}
      </span>

      <span className="wl-authority-chip is-muted">
        <Clock3 aria-hidden="true" />
        当前文件版本已绑定
      </span>

      <span className="wl-authority-meta">
        {view.aircraftFamily} ·{' '}
        {view.authority === 'engineer_confirmed'
          ? '人工确认已记录，仍不等于正式批准'
          : view.authority === 'formal_readback'
            ? '正式系统回读结果'
            : view.overall
              ? '候选意见，待工程师复核'
              : '综合评估尚未形成'}
      </span>
    </div>
  );
}
