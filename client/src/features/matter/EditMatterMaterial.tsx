import { useRef, useState } from 'react';
import { useCurrentUserSession } from '@client/src/app/providers/CurrentUserSessionProvider';
import { reviseEngineeringMatterMaterials } from '@client/src/api/engineering-matter';
import { Button } from '@client/src/components/ui/button';
import { Input } from '@client/src/components/ui/input';
import { Textarea } from '@client/src/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@client/src/components/ui/dialog';
import { createRequestCorrelationId } from '@client/src/utils/request-correlation-id';
import type {
  MatterMaterialLink,
  ReviseMatterMaterialsRequest,
} from '@shared/matter-material.interface';

export default function EditMatterMaterial({
  matterId,
  revision,
  material,
  disabled,
  onSaved,
}: {
  matterId: string;
  revision: number;
  material: MatterMaterialLink;
  disabled: boolean;
  onSaved: () => Promise<void>;
}) {
  const { authenticationRequired } = useCurrentUserSession();
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState(material.kind);
  const [included, setIncluded] = useState(material.disposition === 'INCLUDED');
  const [scope, setScope] = useState(material.scope);
  const [contribution, setContribution] = useState(material.contribution);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pending = useRef<ReviseMatterMaterialsRequest | null>(null);
  const submitting = useRef(false);
  const [locked, setLocked] = useState(false);

  async function save() {
    if (submitting.current || disabled || authenticationRequired) return;
    submitting.current = true;
    setBusy(true);
    setError(null);
    try {
      if (!saved) {
        const replacement: MatterMaterialLink = {
          ...material,
          ...(material.kind !== 'EXPECTED' && kind !== 'EXPECTED'
            ? { kind }
            : {}),
          origin: 'ENGINEER',
          disposition: included ? 'INCLUDED' : 'EXCLUDED',
          scope: scope.trim(),
          contribution: contribution.trim(),
        };
        pending.current ??= {
          requestId: createRequestCorrelationId(),
          expectedMatterRevision: revision,
          changeSummary: reason.trim(),
          upserts: [replacement],
        };
        setLocked(true);
        await reviseEngineeringMatterMaterials(matterId, pending.current);
        setSaved(true);
      }
      await onSaved();
      setOpen(false);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : '材料调整未能完成，请核对后重试。',
      );
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (!busy) setOpen(value);
      }}
    >
      <DialogTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          disabled={disabled || authenticationRequired}
        >
          调整材料关系
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>调整材料关系</DialogTitle>
          <DialogDescription>
            说明这份材料参与当前问题的范围和作用。排除后保留原关系及历史，已有评估仍显示其实际覆盖范围。
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <fieldset disabled={busy || locked} className="space-y-4">
            {material.kind !== 'EXPECTED' ? (
              <label className="block space-y-1 text-sm">
                材料用途
                <select
                  className="block w-full rounded-md border border-input bg-background p-2"
                  value={kind}
                  onChange={(event) =>
                    setKind(
                      event.target.value === 'MEMBER' ? 'MEMBER' : 'RELATED',
                    )
                  }
                >
                  <option value="MEMBER">同事项成员</option>
                  <option value="RELATED">相关参考</option>
                </select>
              </label>
            ) : (
              <p className="text-sm">
                预期资料：尚未取得的内容不作为已读来源。
              </p>
            )}
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={included}
                onChange={(event) => setIncluded(event.target.checked)}
              />
              纳入当前事项
            </label>
            <label className="block space-y-1 text-sm">
              参与范围
              <Input
                required
                maxLength={2000}
                value={scope}
                onChange={(event) => setScope(event.target.value)}
              />
            </label>
            <label className="block space-y-1 text-sm">
              材料作用
              <Textarea
                required
                maxLength={4000}
                value={contribution}
                onChange={(event) => setContribution(event.target.value)}
              />
            </label>
            <label className="block space-y-1 text-sm">
              调整原因
              <Textarea
                required
                maxLength={1000}
                value={reason}
                onChange={(event) => setReason(event.target.value)}
              />
            </label>
          </fieldset>
          {error ? (
            <p role="alert" className="text-sm">
              {error}
            </p>
          ) : null}
          {saved ? (
            <p role="status" className="text-sm">
              调整已保存；重新读取最新事项不会再次提交。
            </p>
          ) : locked && !busy ? (
            <p className="text-sm">
              本次请求已保留。重试会核对同一请求；若事项已更新，请关闭后重新读取事项。
            </p>
          ) : null}
          <div className="flex gap-3">
            <Button
              type="submit"
              disabled={
                busy ||
                disabled ||
                authenticationRequired ||
                !scope.trim() ||
                !contribution.trim() ||
                !reason.trim()
              }
            >
              {busy
                ? '正在保存与核对…'
                : saved
                  ? '重新读取事项'
                  : locked
                    ? '核对并重试本次保存'
                    : '保存调整'}
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() => setOpen(false)}
            >
              关闭
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
