import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useCurrentUserSession } from '@client/src/app/providers/CurrentUserSessionProvider';
import { getEngineeringMatter } from '@client/src/api/engineering-matter';
import type {
  CanonicalLibraryDocumentSummary,
  EngineeringMatterReadModel,
} from '@shared/api.interface';
import type { MatterMaterialLink } from '@shared/matter-material.interface';
import { Button } from '@client/src/components/ui/button';
import { createRequestCorrelationId } from '@client/src/utils/request-correlation-id';
import EditMatterMaterial from './EditMatterMaterial';
import { matterOverviewRoute } from './matter-navigation';

export default function LinkDocumentMatterMaterial({
  matterId,
  document,
}: {
  matterId: string;
  document: CanonicalLibraryDocumentSummary;
}) {
  const navigate = useNavigate();
  const { authenticationRequired, sessionGeneration } = useCurrentUserSession();
  const [matter, setMatter] = useState<EngineeringMatterReadModel | null>(null);
  const [readRevision, setReadRevision] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [documentVersionId, setDocumentVersionId] = useState(
    document.versions[0]?.documentVersionId ?? '',
  );
  useEffect(() => {
    const controller = new AbortController();
    setMatter(null);
    setError(null);
    if (!authenticationRequired)
      void getEngineeringMatter(matterId, controller.signal)
        .then((value) => {
          if (!controller.signal.aborted) setMatter(value);
        })
        .catch((cause) => {
          if (!controller.signal.aborted)
            setError(cause instanceof Error ? cause.message : '事项读取失败。');
        });
    return () => controller.abort();
  }, [matterId, authenticationRequired, sessionGeneration, readRevision]);
  const selected = document.versions.find(
    (version) => version.documentVersionId === documentVersionId,
  );
  const alreadyLinked =
    matter?.catalog.entries.some(
      (entry) => entry.document.documentVersionId === documentVersionId,
    ) ||
    matter?.materials?.some(
      (material) =>
        material.kind !== 'EXPECTED' &&
        material.documentVersionId === documentVersionId,
    );
  const materialId = useMemo(
    () => `material:${createRequestCorrelationId()}`,
    [documentVersionId],
  );
  const sameFamily =
    matter?.catalog.entries.some(
      (entry) => entry.documentCurrentness.familyId === document.familyId,
    ) ||
    matter?.materials?.some(
      (material) =>
        material.kind === 'MEMBER' && material.familyId === document.familyId,
    );
  const material: MatterMaterialLink = {
    materialId,
    kind: sameFamily ? 'MEMBER' : 'RELATED',
    familyId: document.familyId,
    documentVersionId,
    scope: '核查所选文件版本的工程问题、条件及本版变化。',
    contribution:
      '与事项已有材料比较，形成有来源依据的判断；加入材料本身不代表已核查或正式采用。',
    basis: [],
    origin: 'ENGINEER',
    disposition: 'INCLUDED',
  };
  return (
    <section className="space-y-3" aria-label="将文档版本加入事项">
      <h3 className="font-medium">
        加入材料{matter ? ` · ${matter.title}` : ''}
      </h3>
      <label className="block space-y-1 text-sm">
        选择原文版本
        <select
          className="block w-full rounded-md border border-input bg-background p-2"
          value={documentVersionId}
          onChange={(event) => setDocumentVersionId(event.target.value)}
        >
          {document.versions.map((version) => (
            <option
              key={version.documentVersionId}
              value={version.documentVersionId}
            >
              {version.originalFilename} ·{' '}
              {version.revisionDate ||
                version.sourceGeneratedDate ||
                '日期未标注'}
            </option>
          ))}
        </select>
      </label>
      <p className="text-sm">
        关联所选原件并保留已有材料，随后核查其作用及版本变化。
      </p>
      {authenticationRequired ? (
        <p role="alert">请先登录。</p>
      ) : error ? (
        <p role="alert">{error}</p>
      ) : !matter ? (
        <p role="status">正在读取事项…</p>
      ) : alreadyLinked ? (
        <p role="status">这个版本已有关联，可返回事项核对材料关系。</p>
      ) : selected ? (
        <EditMatterMaterial
          key={`${sessionGeneration}:${matter.currentRevision.revisionNo}:${documentVersionId}`}
          matterId={matterId}
          revision={matter.currentRevision.revisionNo}
          material={material}
          disabled={authenticationRequired}
          actionLabel="将所选版本加入事项"
          onSaved={async () => {
            navigate(`${matterOverviewRoute(matterId)}?panel=materials`);
          }}
        />
      ) : null}
      <Button
        variant="outline"
        size="sm"
        disabled={authenticationRequired}
        onClick={() => setReadRevision((value) => value + 1)}
      >
        重新读取事项
      </Button>
      <Link
        className="block text-sm underline"
        to={`${matterOverviewRoute(matterId)}?panel=materials`}
      >
        返回事项
      </Link>
    </section>
  );
}
