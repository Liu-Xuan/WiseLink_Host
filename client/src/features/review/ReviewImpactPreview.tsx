import { useEffect, useRef } from 'react';
import { AlertTriangle, ClipboardCheck, RefreshCw } from 'lucide-react';

import { Button } from '@client/src/components/ui/button';

import './review-loop.css';

export interface ReviewImpactPreviewProps {
  open: boolean;
  criterionId: string;
  criterionConclusion: string;
  decision: string;
  comment: string;
  /** 当前 WorkItem revision（写入时校验） */
  expectedRevision: number;
  /** 整体候选当前状态（预览将标记为需重综合） */
  overallStatus: string | null;
  submitting: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

/**
 * 复核提交前影响预览（Spec R01 §4.3）。
 * 工程师修改一项判断时，先显示影响预览，再写入：
 * 不直接改写已有分析结果；旧综合意见会标记“需更新”，再由分析任务重新综合。
 */
export default function ReviewImpactPreview({
  open,
  criterionId,
  criterionConclusion,
  decision,
  comment,
  expectedRevision,
  submitting,
  onCancel,
  onConfirm,
}: ReviewImpactPreviewProps) {
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCancel();
    };
    document.addEventListener('keydown', onKey);
    dialogRef.current?.focus();
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onCancel]);

  if (!open) return null;

  return (
    <div
      className="wl-review-impact-backdrop"
      role="presentation"
      onClick={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <div
        ref={dialogRef}
        className="wl-review-impact-dialog wl-glass-content"
        role="dialog"
        aria-modal="true"
        aria-labelledby="wl-review-impact-title"
        tabIndex={-1}
      >
        <header>
          <ClipboardCheck aria-hidden="true" />
          <div>
            <span>工程师复核 · 写入影响确认</span>
            <h3 id="wl-review-impact-title">写入前确认影响</h3>
          </div>
        </header>

        <dl className="wl-review-impact-facts">
          <div>
            <dt>规则项</dt>
            <dd>{criterionId}</dd>
          </div>
          <div>
            <dt>当前初步判断</dt>
            <dd>{criterionConclusion}</dd>
          </div>
          <div>
            <dt>处理意见</dt>
            <dd>{decision}</dd>
          </div>
          <div>
            <dt>说明</dt>
            <dd>{comment || '（未填写说明）'}</dd>
          </div>
        </dl>

        <div className="wl-review-impact-consequences" aria-label="写入影响">
          <strong>
            <AlertTriangle aria-hidden="true" /> 本次写入将产生以下影响
          </strong>
          <ul>
            <li>追加一条工程师复核意见；不会立即改写已有分析结果。</li>
            <li>
              当前整体综合意见将标记为 <em>需更新</em>
              ，随后由分析任务按受控流程重新综合。
            </li>
            <li>
              以当前页面版本 r{expectedRevision}
              写入；若系统已有更新，会提示刷新且不会覆盖新结果。
            </li>
          </ul>
        </div>

        <footer>
          <Button type="button" variant="ghost" onClick={onCancel}>
            返回修改
          </Button>
          <Button
            type="button"
            disabled={submitting}
            onClick={onConfirm}
            data-ai-section-type="button"
          >
            {submitting ? (
              <>
                <RefreshCw className="wl-spin" aria-hidden="true" /> 正在写入…
              </>
            ) : (
              '确认写入'
            )}
          </Button>
        </footer>
      </div>
    </div>
  );
}
