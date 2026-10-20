import { useId, useState } from 'react';
import { Button } from '@client/src/components/ui/button';
import { createRequestCorrelationId } from '@client/src/utils/request-correlation-id';
import type { JobAidProblemIssue, JobAidWorkRevision } from '@shared/jobaid-problem-assessment.interface';
import {
  jobAidCorrectionEvidence,
  prepareJobAidCorrection,
  type JobAidCorrectionDraft,
  type PendingJobAidCorrection,
} from './jobaid-work-correction';
import { useJobAidWorkCorrection } from './useJobAidWorkCorrection';

interface Props {
  work: JobAidWorkRevision;
  workItemRevision?: number;
  available: boolean;
  onConfirmed: () => void;
}

/** The normal saved-work reader owns this small text editor and its recovery control. */
export default function JobAidWorkCorrectionControl(props: Props) {
  const [open, setOpen] = useState(false);
  const enabled: boolean = !!props.workItemRevision && !props.work.content.historicalSourceSchema;
  const correction = useJobAidWorkCorrection(props.work.workItemId, enabled, () => {
    setOpen(false);
    props.onConfirmed();
  });
  if (!enabled) return null;
  return (
    <>
      <Button type="button" variant="outline" size="sm" aria-expanded={open}
        disabled={!props.available || !correction.ready || correction.busy || !!correction.pending}
        onClick={() => setOpen((value) => !value)}>
        更正文案
      </Button>
      {!correction.ready && correction.failed ? <Button type="button" variant="ghost" size="sm"
        onClick={correction.recheck}>重新核对</Button> : null}
      {correction.pending ? (
        <div className="wl-jobaid-correction-recovery">
          <Button type="button" variant="outline" size="sm" disabled={correction.busy || !correction.ready}
            onClick={() => correction.recover()}>
            {correction.busy ? '正在核对…' : '核对上次保存结果'}
          </Button>
          {correction.missing && correction.pending.command ? <Button type="button" variant="ghost" size="sm" disabled={correction.busy}
            onClick={() => correction.recover(true)}>重试同一请求</Button> : null}
        </div>
      ) : null}
      {correction.message ? <p className="wl-jobaid-correction-message" role={correction.failed ? 'alert' : 'status'}>
        {correction.message}
      </p> : null}
      {open && !correction.pending ? (
        <JobAidCorrectionForm key={props.work.workRevisionRef} work={props.work}
          workItemRevision={props.workItemRevision!} disabled={!props.available || correction.busy}
          onCancel={() => setOpen(false)} onSubmit={correction.submit} />
      ) : null}
    </>
  );
}

function draftForIssue(work: JobAidWorkRevision, issue: JobAidProblemIssue): JobAidCorrectionDraft {
  const actual: Set<string> = new Set(jobAidCorrectionEvidence(work).map((item) => item.evidenceRef));
  const targetRefs: string[] = [
    ...issue.sourceDependencies, ...issue.premiseRefs,
    ...issue.riskScenarios.flatMap((scenario) => scenario.severity?.basisRefs ?? []),
    ...[...issue.body.matchAll(/\[\[([^\[\]\r\n]+)\]\]/gu)].map((match) => match[1]),
  ];
  return { issueKey: issue.issueKey, body: issue.body,
    severityReasons: issue.riskScenarios.map((scenario) => scenario.severity?.reason ?? ''),
    reason: '', contribution: '', evidenceRefs: [...new Set(targetRefs.filter((ref) => actual.has(ref)))] };
}

function JobAidCorrectionForm({ work, workItemRevision, disabled, onCancel, onSubmit }: {
  work: JobAidWorkRevision;
  workItemRevision: number;
  disabled: boolean;
  onCancel: () => void;
  onSubmit: (pending: PendingJobAidCorrection) => Promise<void>;
}) {
  const id: string = useId();
  const [draft, setDraft] = useState<JobAidCorrectionDraft>(() => draftForIssue(work, work.content.issues[0]));
  const [error, setError] = useState('');
  const issue = work.content.issues.find((item) => item.issueKey === draft.issueKey)!;
  const evidence = jobAidCorrectionEvidence(work);
  return (
    <form className="wl-jobaid-correction" aria-label="更正已保存的文案" onSubmit={(event) => {
      event.preventDefault();
      if (disabled) return;
      try {
        const pending: PendingJobAidCorrection = prepareJobAidCorrection(work, workItemRevision, draft, createRequestCorrelationId());
        setError('');
        void onSubmit(pending);
      } catch (caught: unknown) {
        setError(caught instanceof Error ? caught.message : '请核对更正内容。');
      }
    }}>
      <div className="wl-jobaid-correction-heading">
        <strong>更正问题文案</strong>
        <span>基于工作修订 {work.workRevision} · 本次保存为候选更正</span>
      </div>
      <fieldset disabled={disabled}>
        <label htmlFor={`${id}-issue`}>问题</label>
        <select id={`${id}-issue`} value={draft.issueKey} onChange={(event) => {
          const selected = work.content.issues.find((item) => item.issueKey === event.target.value);
          if (selected) { setDraft(draftForIssue(work, selected)); setError(''); }
        }}>
          {work.content.issues.map((item) => <option key={item.issueKey} value={item.issueKey}>{item.question}</option>)}
        </select>
        <label htmlFor={`${id}-body`}>问题正文</label>
        <textarea id={`${id}-body`} rows={9} value={draft.body} maxLength={1_000_000}
          onChange={(event) => setDraft({ ...draft, body: event.target.value })} />
        {issue.riskScenarios.map((scenario, index) => scenario.severity ? (
          <div key={index} className="wl-jobaid-correction-scenario">
            <label htmlFor={`${id}-severity-${index}`}>严重性理由 · 情景 {index + 1}</label>
            <p>{scenario.scenario}</p>
            <textarea id={`${id}-severity-${index}`} rows={5} maxLength={1_000_000}
              value={draft.severityReasons[index]} onChange={(event) => setDraft({ ...draft,
                severityReasons: draft.severityReasons.map((value, position) => position === index ? event.target.value : value),
              })} />
          </div>
        ) : null)}
        <div className="wl-jobaid-correction-context">
          <label htmlFor={`${id}-contribution`}>实际贡献方式</label>
          <select id={`${id}-contribution`} value={draft.contribution} required onChange={(event) => {
            const contribution = event.target.value;
            if (contribution === '' || contribution === 'ENGINEER' || contribution === 'AI_ASSISTED')
              setDraft({ ...draft, contribution });
          }}>
            <option value="">请选择</option>
            <option value="ENGINEER">工程师撰写</option>
            <option value="AI_ASSISTED">AI 整理，经本人核对</option>
          </select>
          <label htmlFor={`${id}-reason`}>更正理由</label>
          <textarea id={`${id}-reason`} rows={3} value={draft.reason} required maxLength={3800}
            onChange={(event) => setDraft({ ...draft, reason: event.target.value })} />
        </div>
        <details className="wl-jobaid-correction-evidence">
          <summary>更正依据（已选 {draft.evidenceRefs.length}）</summary>
          {evidence.map((item) => <label key={item.evidenceRef}>
            <input type="checkbox" checked={draft.evidenceRefs.includes(item.evidenceRef)}
              onChange={(event) => setDraft({ ...draft, evidenceRefs: event.target.checked
                ? [...draft.evidenceRefs, item.evidenceRef]
                : draft.evidenceRefs.filter((ref) => ref !== item.evidenceRef) })} />
            <span>{item.title}{item.versionLabel ? ` · ${item.versionLabel}` : ''}</span>
          </label>)}
          {!evidence.length ? <p>本工作暂无已登记且实际读过的更正依据。</p> : null}
        </details>
      </fieldset>
      {error ? <p role="alert">{error}</p> : null}
      <div className="wl-jobaid-correction-buttons">
        <Button type="submit" size="sm" disabled={disabled || !evidence.length}>保存更正</Button>
        <Button type="button" size="sm" variant="ghost" disabled={disabled} onClick={onCancel}>取消</Button>
      </div>
    </form>
  );
}
