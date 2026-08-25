import {
  AlertTriangle,
  CheckCircle2,
  ClipboardList,
  FileCheck2,
  FileOutput,
  LockKeyhole,
  Search,
} from 'lucide-react';
import { Link } from 'react-router-dom';

import { Button } from '@client/src/components/ui/button';
import { humanState } from '@client/src/features/navigation/treeMappers';
import type {
  CanonicalAeoCandidateArtifactProjection,
  CanonicalAeoCandidateProjection,
  CanonicalIntegratedAssessmentProjection,
} from '@shared/api.interface';

interface AeoAuthoringWorkspaceProps {
  workItemId: string;
  workItemRevision: number;
  aeo: CanonicalAeoCandidateProjection;
  integratedAssessment: CanonicalIntegratedAssessmentProjection | null;
}

const ARTIFACT_LABELS: Record<
  CanonicalAeoCandidateArtifactProjection['artifactKind'],
  string
> = {
  AUTHORING_BOOTSTRAP: '编写素材',
  WORKING_COPY: 'Working copy',
  DRAFT_PACKAGE: 'Draft package',
  WORD_EXPORT: 'Word candidate',
};

export function AeoAuthoringWorkspace({
  workItemId,
  workItemRevision,
  aeo,
  integratedAssessment,
}: AeoAuthoringWorkspaceProps) {
  const overall = integratedAssessment?.overallSynthesis ?? null;
  const confirmation = integratedAssessment?.overallForAeoConfirmation ?? null;

  return (
    <section
      className="aeo-authoring-workspace"
      id="workspace-aeo"
      aria-label="AEO 候选编写工作区"
    >
      <header className="aeo-authoring-header">
        <div>
          <div className="parse-panel-label">
            <FileOutput aria-hidden="true" /> AEO AUTHORING · SAME WORKITEM
          </div>
          <p className="aeo-authoring-kicker">CANDIDATE AUTHORING SURFACE</p>
          <h2>{aeo.targetIdentity}</h2>
          <p>
            当前工作区只处理候选编写素材。它不会创建正式
            EO、改变当前有效结果、替代 AAmis，也不会把 AI
            候选意见升级为工程结论。
          </p>
        </div>
        <div className="aeo-authoring-seal">
          <span>AUTHORITY</span>
          <strong>待工程师确认</strong>
          <small>{humanState(aeo.status)}</small>
        </div>
      </header>

      <div className="aeo-authoring-grid">
        <aside className="aeo-authoring-structure" aria-label="候选结构">
          <div className="aeo-authoring-section-label">
            <ClipboardList aria-hidden="true" /> 候选结构
          </div>
          <div className="aeo-authoring-structure-list">
            {aeo.artifacts.map((artifact) => (
              <ArtifactRow
                artifact={artifact}
                key={`${artifact.artifactKind}:${artifact.artifactSha256}`}
              />
            ))}
          </div>
          <div className="aeo-authoring-boundary">
            <LockKeyhole aria-hidden="true" />
            <p>保存、重排和导出能力尚未接通，当前仅可核对候选素材。</p>
          </div>
        </aside>

        <div className="aeo-authoring-editor" aria-label="受控编辑区">
          <div className="aeo-authoring-section-label">
            <FileCheck2 aria-hidden="true" /> 受控编辑区
          </div>
          <div className="aeo-authoring-editor-placeholder">
            <div className="aeo-authoring-placeholder-icon">
              <FileOutput aria-hidden="true" />
            </div>
            <h3>编辑能力尚未连接</h3>
            <p>
              当前只返回候选素材索引，尚未提供可编辑段落、双语字段和原文绑定。页面不会猜测步骤正文或保存本地草稿。
            </p>
            <div className="aeo-authoring-editor-actions">
              <Button type="button" disabled title="编辑能力尚未连接">
                编辑 Working copy
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled
                title="来源读取能力尚未连接"
              >
                读取来源绑定
              </Button>
            </div>
          </div>
        </div>

        <aside className="aeo-authoring-inspector" aria-label="候选证据检查器">
          <div className="aeo-authoring-section-label">
            <Search aria-hidden="true" /> 证据与门槛
          </div>
          <dl className="aeo-authoring-facts">
            <div>
              <dt>工程事项</dt>
              <dd title={workItemId}>{short(workItemId)}</dd>
            </div>
            <div>
              <dt>事项版本</dt>
              <dd>{workItemRevision}</dd>
            </div>
            <div>
              <dt>来源候选</dt>
              <dd>{aeo.sourceCandidateCount}</dd>
            </div>
            <div>
              <dt>整体综合</dt>
              <dd>{humanState(overall?.status) || '尚未形成'}</dd>
            </div>
            <div>
              <dt>人工确认</dt>
              <dd>
                {confirmation
                  ? `第 ${confirmation.overallRevision} 版`
                  : '未确认'}
              </dd>
            </div>
            <div>
              <dt>自动采纳</dt>
              <dd>禁止</dd>
            </div>
          </dl>
          <div className="aeo-authoring-warning">
            <AlertTriangle aria-hidden="true" />
            <span>候选仍需工程师复核；状态不代表工程、适航或发布结论。</span>
          </div>
          <Link
            className="aeo-authoring-reader-link"
            to={`/work-items/${encodeURIComponent(workItemId)}/documents?node=reader&tab=reader`}
          >
            返回原文查看同一事项的来源
          </Link>
        </aside>
      </div>

      <footer className="aeo-authoring-footer">
        <span>候选素材保留来源与文件校验记录</span>
        <span>当前编辑器不会另建事项或资料目录</span>
      </footer>
    </section>
  );
}

function ArtifactRow({
  artifact,
}: {
  artifact: CanonicalAeoCandidateArtifactProjection;
}) {
  const stateClass = artifact.state.toLowerCase();
  return (
    <div className={`aeo-authoring-artifact is-${stateClass}`}>
      <div>
        <strong>{ARTIFACT_LABELS[artifact.artifactKind]}</strong>
        <span>{artifact.state}</span>
      </div>
      <small>
        {artifact.byteLength.toLocaleString()} bytes ·{' '}
        {short(artifact.artifactSha256)}
      </small>
      {artifact.state === 'AVAILABLE' ? (
        <CheckCircle2 aria-label="可读取" />
      ) : null}
    </div>
  );
}

function short(value: string): string {
  return value.length > 28 ? `${value.slice(0, 15)}…${value.slice(-9)}` : value;
}
