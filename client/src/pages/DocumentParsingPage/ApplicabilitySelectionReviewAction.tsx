import { useEffect, useState, type FC } from 'react';

import { canonicalHost } from '@client/src/api';
import { Button } from '@client/src/components/ui/button';
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '@client/src/components/ui/dialog';
import { Input } from '@client/src/components/ui/input';
import { Label } from '@client/src/components/ui/label';
import type {
  CanonicalApplicabilitySelectionReadModel,
  CanonicalApplicabilitySelectionReviewAvailability,
  CanonicalApplicabilitySelectionReviewDraft,
} from '@shared/api.interface';

interface ApplicabilitySelectionReviewActionProps {
  workItemId: string;
  workItemRevision: number;
  onConfirmed: () => Promise<void>;
}

const ApplicabilitySelectionReviewAction: FC<
  ApplicabilitySelectionReviewActionProps
> = ({ workItemId, workItemRevision, onConfirmed }) => {
  const [availability, setAvailability] = useState<boolean | null>(null);
  const [availabilityError, setAvailabilityError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [aircraftIdentifier, setAircraftIdentifier] = useState('');
  const [asOf, setAsOf] = useState('');
  const [draft, setDraft] =
    useState<CanonicalApplicabilitySelectionReviewDraft | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setAvailability(null);
    setAvailabilityError(null);
    setDraft(null);
    void canonicalHost.getApplicabilitySelectionReviewAvailability(workItemId)
      .then((result: CanonicalApplicabilitySelectionReviewAvailability) => {
        if (active) setAvailability(result.enabled);
      })
      .catch((reason: unknown) => {
        if (!active) return;
        setAvailabilityError(reason instanceof Error ? reason.message :
          '无法读取受控选择确认入口。');
      });
    return () => { active = false; };
  }, [workItemId, workItemRevision]);

  const preview = async (): Promise<void> => {
    if (busy || !aircraftIdentifier.trim() || !asOf.trim()) return;
    setBusy(true);
    setError(null);
    setDraft(null);
    try {
      const result = await canonicalHost.previewApplicabilitySelectionReviewAction(
        workItemId, { aircraftIdentifier, asOf, expectedWorkItemRevision: workItemRevision },
      );
      setDraft(result);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '来源预览失败，请刷新后重试。');
    } finally {
      setBusy(false);
    }
  };

  const confirmSelection = async (): Promise<void> => {
    if (busy || !draft) return;
    setBusy(true);
    setError(null);
    try {
      const saved: CanonicalApplicabilitySelectionReadModel =
        await canonicalHost.confirmApplicabilitySelectionReviewAction(
          workItemId, { draft, confirmed: true },
        );
      if (!matchesDraft(saved, draft))
        throw new Error('APPLICABILITY_SELECTION_CONFIRM_READBACK_MISMATCH');
      await onConfirmed();
      setOpen(false);
      setDraft(null);
    } catch (reason) {
      try {
        const current = await canonicalHost.getApplicabilitySelection(workItemId);
        if (matchesDraft(current, draft)) {
          setError('目标已保存，但页面刷新未完成。请刷新工作项读取最新状态。');
          setDraft(null);
        } else {
          setError('确认结果与当前工作项不一致。请刷新后重新核对来源。');
        }
      } catch {
        setError(reason instanceof Error
          ? `${reason.message}；保存状态尚未确认，请刷新工作项后再操作。`
          : '保存状态尚未确认，请刷新工作项后再操作。');
      }
    } finally {
      setBusy(false);
    }
  };

  if (availabilityError) return (
    <p role="alert" className="text-sm text-destructive">{availabilityError}</p>
  );
  if (!availability) return null;

  return (
    <>
      <Button type="button" variant="outline" onClick={() => setOpen(true)}>
        确认受控评估目标
      </Button>
      <Dialog open={open} onOpenChange={(next) => { if (!busy) {
        setOpen(next); if (!next) { setDraft(null); setError(null); }
      } }}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>确认适用性评估目标</DialogTitle>
            <DialogDescription>
              选择真实飞机与评估日期。Host 将核对受控机队来源并显示版本；
              构型事实缺失时保持 UNKNOWN。确认后只保存候选评估范围，
              不代表工程结论正式采用。
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <Label htmlFor="applicability-aircraft">飞机标识</Label>
            <Input id="applicability-aircraft" value={aircraftIdentifier}
              autoComplete="off" maxLength={64} disabled={busy}
              onChange={(event) => { setAircraftIdentifier(event.target.value);
                setDraft(null); setError(null); }} />
            <Label htmlFor="applicability-as-of">评估日期（YYYY-MM-DD）</Label>
            <Input id="applicability-as-of" value={asOf} placeholder="YYYY-MM-DD"
              inputMode="numeric" maxLength={10} disabled={busy}
              onChange={(event) => { setAsOf(event.target.value);
                setDraft(null); setError(null); }} />
            <Button type="button" variant="outline" disabled={busy ||
              !aircraftIdentifier.trim() || !/^\d{4}-\d{2}-\d{2}$/u.test(asOf)}
              onClick={() => void preview()}>
              {busy && !draft ? '正在核对来源…' : '核对目标与来源'}
            </Button>
          </div>
          {draft ? (
            <div className="rounded-md border p-3 text-sm">
              <p>飞机：{draft.aircraftIdentifier}；评估日期：{draft.asOf}</p>
              <p>文档版本：{draft.documentVersionId}</p>
              <p>机队快照：{draft.fleetSource.snapshotId}</p>
              <p>来源修订：{draft.fleetSource.sourceRevisionKey}</p>
              <p>权威修订：{draft.fleetSource.authorityRevision}</p>
              <p>来源日期：{draft.fleetSource.sourceAsOf}</p>
              <p>确认有效至：{new Date(draft.expiresAt).toLocaleString()}</p>
              <Button type="button" disabled={busy || Date.parse(draft.expiresAt) <= Date.now()}
                onClick={() => void confirmSelection()}>
                {busy ? '正在确认…' : '确认并保存该评估目标'}
              </Button>
            </div>
          ) : null}
          {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
        </DialogContent>
      </Dialog>
    </>
  );
};

function matchesDraft(
  saved: CanonicalApplicabilitySelectionReadModel,
  draft: CanonicalApplicabilitySelectionReviewDraft,
): boolean {
  return saved.workItemId === draft.workItemId &&
    saved.documentVersionId === draft.documentVersionId &&
    saved.workItemRevision === draft.expectedWorkItemRevision + 1 &&
    saved.aircraftIdentifier === draft.aircraftIdentifier && saved.asOf === draft.asOf &&
    saved.fleetSource.snapshotId === draft.fleetSource.snapshotId &&
    saved.fleetSource.sourceRevisionKey === draft.fleetSource.sourceRevisionKey &&
    saved.fleetSource.authorityRevision === draft.fleetSource.authorityRevision &&
    saved.fleetSource.sourceAsOf === draft.fleetSource.sourceAsOf;
}

export default ApplicabilitySelectionReviewAction;
