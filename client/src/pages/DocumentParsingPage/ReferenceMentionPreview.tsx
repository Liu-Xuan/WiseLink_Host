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
  CanonicalReferencePermissionState,
  CanonicalReferenceTargetResolution,
  CanonicalRelatedContextEvidenceStance,
  CanonicalRelatedContextSourceAuthority,
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
    setPreview(null);
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
            <p>只读候选 · 未进入评估输入 · 未接受关系</p>
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
          <span>
            关联上下文暂不可用；主复核可继续，但不会把不可用当成无关联。
          </span>
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
  const resolvedTarget =
    mention.targetResolution.status === 'RESOLVED_EXACT'
      ? mention.targetResolution
      : null;

  return (
    <article>
      <FileSymlink aria-hidden="true" />
      <div className="reference-preview-identity">
        <strong>
          {mention.normalizedIdentity.documentNumber ?? mention.citationText}
        </strong>
        <span>{mention.citationText}</span>
      </div>
      <div className="reference-preview-meta">
        <small>{mention.documentTypeCandidate}</small>
        <small>关系候选：{ROLE_LABELS[mention.contextRole]}</small>
        <ResolutionState value={mention.resolutionState} />
        {mention.resolutionState === 'RESOLVED_EXACT' ? (
          <small>目标版本：目录当前</small>
        ) : null}
        <TargetApplicability value={mention.targetApplicability} />
        <EvidenceStance value={mention.evidenceStance} />
        <SourceAuthority value={mention.sourceAuthority} />
        <PermissionState value={mention.permissionState} />
        <small>
          提取：
          {mention.extractionMethod === 'STRUCTURED_REFERENCE'
            ? '结构化引用'
            : '确定性文本'}
        </small>
        {mention.normalizedIdentity.publisher ? (
          <small>发布方候选：{mention.normalizedIdentity.publisher}</small>
        ) : null}
      </div>
      <div className="reference-preview-actions">
        {resolvedTarget ? (
          <button
            type="button"
            className="reference-preview-open"
            onClick={() => onOpenTarget(resolvedTarget.workItemId)}
          >
            <ExternalLink aria-hidden="true" />
            打开关联文件
            {resolvedTarget.businessRevision
              ? ` · ${resolvedTarget.businessRevision}`
              : ''}
          </button>
        ) : null}
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
      </div>
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
      目标适用性：{labels[value]}
    </small>
  );
}

function ResolutionState({
  value,
}: {
  value: CanonicalReferenceTargetResolution['status'];
}) {
  const label: Record<CanonicalReferenceTargetResolution['status'], string> = {
    RESOLVED_EXACT: '精确解析',
    RESOLVED_MULTIPLE: '多个匹配',
    UNRESOLVED: '未解析',
    DOCUMENT_NOT_INGESTED: '未收录',
    UNAVAILABLE: '解析服务不可用',
    ACCESS_DENIED: '无权访问',
    UNSUPPORTED_DOCUMENT: '暂不支持该资料类型',
  };
  return (
    <small className={`reference-preview-resolution is-${value}`}>
      解析：{label[value]}
    </small>
  );
}

function PermissionState({
  value,
}: {
  value: CanonicalReferencePermissionState;
}) {
  const labels: Record<CanonicalReferencePermissionState, string> = {
    AUTHORIZED: '已授权读取',
    DENIED: '无权读取',
    NOT_CHECKED: '尚未核验权限',
  };
  return <small>权限：{labels[value]}</small>;
}

function EvidenceStance({
  value,
}: {
  value: CanonicalRelatedContextEvidenceStance;
}) {
  const labels: Record<CanonicalRelatedContextEvidenceStance, string> = {
    SUPPORTS: '支持',
    CONTRADICTS: '反驳',
    NEUTRAL: '中性',
    NOT_EVALUATED: '未评估',
  };
  return <small>证据立场：{labels[value]}</small>;
}

function SourceAuthority({
  value,
}: {
  value: CanonicalRelatedContextSourceAuthority;
}) {
  const labels: Record<CanonicalRelatedContextSourceAuthority, string> = {
    REGULATORY: '监管正式',
    OEM_FORMAL: '厂家正式',
    OEM_TRACKING: '厂家跟踪',
    OPERATOR_CONTROLLED: '航司受控',
    AUTHORIZED_REFERENCE: '授权参考',
    REFERENCE_ONLY: '仅供参考',
    UNKNOWN: '未核定',
  };
  return <small>来源权威：{labels[value]}</small>;
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
