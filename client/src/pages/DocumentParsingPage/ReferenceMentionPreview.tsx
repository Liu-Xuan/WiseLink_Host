import { useEffect, useState } from 'react';
import {
  ExternalLink,
  FileSymlink,
  LocateFixed,
  Network,
  RefreshCw,
} from 'lucide-react';

import { canonicalHost } from '@client/src/api';
import type {
  CanonicalReferenceContextRole,
  CanonicalReferenceMentionPreviewItem,
  CanonicalReferenceTargetResolution,
  CanonicalRelatedTargetApplicability,
  CanonicalRelatedContextPreviewResponse,
  CanonicalStructuredContentSourceLocator,
} from '@shared/api.interface';

import './reference-mention-preview.css';

interface ReferenceMentionPreviewProps {
  workItemId: string;
  workItemRevision: number;
  onLocateSourceRef: (
    sourceRef: string,
    locator: CanonicalStructuredContentSourceLocator | undefined,
  ) => void;
  onOpenTarget: (workItemId: string) => void;
}

const ROLE_LABELS: Record<CanonicalReferenceContextRole, string> = {
  CONCURRENT_REQUIREMENT: '并行要求',
  PROCEDURE_SUPPORT: '程序依据',
  RELATED_INFORMATION: '相关资料',
  UNCLASSIFIED: '待分类',
};

export function ReferenceMentionPreview({
  workItemId,
  workItemRevision,
  onLocateSourceRef,
  onOpenTarget,
}: ReferenceMentionPreviewProps) {
  const [preview, setPreview] =
    useState<CanonicalRelatedContextPreviewResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [refreshToken, setRefreshToken] = useState(0);

  useEffect(() => {
    let current = true;
    setLoading(true);
    setError(false);
    void canonicalHost
      .getRelatedContextPreview(workItemId, workItemRevision)
      .then((fresh) => {
        if (current) setPreview(fresh);
      })
      .catch(() => {
        if (current) {
          setPreview(null);
          setError(true);
        }
      })
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => {
      current = false;
    };
  }, [refreshToken, workItemId, workItemRevision]);

  return (
    <section className="reference-preview" aria-label="显式关联上下文预览">
      <header>
        <div className="reference-preview-heading">
          <Network aria-hidden="true" />
          <div>
            <span>关联上下文 · EXPLICIT_PREVIEW</span>
            <h3>正文已显式提到的关联资料</h3>
          </div>
        </div>
        <div className="reference-preview-count">
          <strong>{preview?.totalMentionCount ?? '—'}</strong>
          <span>处引用</span>
        </div>
      </header>

      {loading ? (
        <p className="reference-preview-state">正在从当前受控正文提取…</p>
      ) : error ? (
        <div className="reference-preview-state is-error" role="status">
          <span>关联资料暂未读出，不影响当前复核。</span>
          <button
            type="button"
            onClick={() => setRefreshToken((value) => value + 1)}
          >
            <RefreshCw aria-hidden="true" /> 重试
          </button>
        </div>
      ) : preview?.mentions.length ? (
        <div className="reference-preview-list">
          {preview.mentions.map((mention) => (
            <ReferenceMentionRow
              key={mention.mentionId}
              mention={mention}
              onLocateSourceRef={onLocateSourceRef}
              onOpenTarget={onOpenTarget}
            />
          ))}
        </div>
      ) : (
        <p className="reference-preview-state">
          当前正文未识别到显式关联资料。
        </p>
      )}

      <footer>
        当前展示逐次引用、租户内关联文件解析和上下文作用；
        {preview
          ? `已准备 ${preview.snapshot.items.length} 个关联目标的只读快照。`
          : '只读快照尚未准备。'}
        {preview ? applicabilitySummary(preview) : ''}
        所有关联上下文均未进入评估输入。
      </footer>
    </section>
  );
}

function ReferenceMentionRow({
  mention,
  onLocateSourceRef,
  onOpenTarget,
}: {
  mention: CanonicalReferenceMentionPreviewItem;
  onLocateSourceRef: ReferenceMentionPreviewProps['onLocateSourceRef'];
  onOpenTarget: ReferenceMentionPreviewProps['onOpenTarget'];
}) {
  const locator: CanonicalStructuredContentSourceLocator | undefined =
    mention.sourceLocators.find((item) =>
      item.quote
        ?.toUpperCase()
        .replace(/\s+/gu, '')
        .includes(mention.normalizedTarget.toUpperCase().replace(/\s+/gu, '')),
    ) ?? mention.sourceLocators[0];
  const sourceRef: string | undefined =
    locator?.sourceRefId ?? mention.sourceRefIds[0];

  return (
    <article>
      <FileSymlink aria-hidden="true" />
      <div>
        <strong>{mention.normalizedTarget}</strong>
        <span>{mention.matchedText}</span>
      </div>
      <small>{mention.documentType}</small>
      <small>{ROLE_LABELS[mention.contextRole]}</small>
      <TargetApplicability value={mention.targetApplicability} />
      <TargetResolution
        resolution={mention.targetResolution}
        onOpenTarget={onOpenTarget}
      />
      <button
        type="button"
        disabled={sourceRef === undefined}
        onClick={() => {
          if (sourceRef) onLocateSourceRef(sourceRef, locator);
        }}
      >
        <LocateFixed aria-hidden="true" />
        原文
      </button>
    </article>
  );
}

function TargetApplicability({
  value,
}: {
  value: CanonicalRelatedTargetApplicability;
}) {
  const labels: Record<CanonicalRelatedTargetApplicability, string> = {
    APPLICABLE: '适用',
    NOT_APPLICABLE: '不适用',
    UNKNOWN: '适用性未知',
    NOT_EVALUATED: '未评估',
    NOT_APPLICABILITY_BEARING: '不承担适用性',
  };
  return (
    <small className={`reference-preview-applicability is-${value}`}>
      {labels[value]}
    </small>
  );
}

function TargetResolution({
  resolution,
  onOpenTarget,
}: {
  resolution: CanonicalReferenceTargetResolution;
  onOpenTarget: ReferenceMentionPreviewProps['onOpenTarget'];
}) {
  if (resolution.status === 'RESOLVED_EXACT') {
    return (
      <button
        type="button"
        className="reference-preview-open"
        onClick={() => onOpenTarget(resolution.workItemId)}
      >
        <ExternalLink aria-hidden="true" />
        打开关联文件
        {resolution.businessRevision ? ` · ${resolution.businessRevision}` : ''}
      </button>
    );
  }
  const label: Record<
    Exclude<CanonicalReferenceTargetResolution['status'], 'RESOLVED_EXACT'>,
    string
  > = {
    RESOLVED_MULTIPLE: '多个匹配',
    DOCUMENT_NOT_INGESTED: '未收录',
    ACCESS_DENIED: '无权访问',
  };
  return (
    <small className={`reference-preview-resolution is-${resolution.status}`}>
      {label[resolution.status]}
    </small>
  );
}

function applicabilitySummary(
  preview: CanonicalRelatedContextPreviewResponse,
): string {
  const evaluated = preview.snapshot.items.filter(
    (item) => item.targetApplicability !== 'NOT_EVALUATED',
  ).length;
  if (evaluated === 0) return '目标文档尚无可复用的当前适用性结果；';
  return `已复用 ${evaluated} 个目标文档自己的当前适用性结果；`;
}
