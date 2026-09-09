import { useEffect, useRef, useState } from 'react';
import type {
  CanonicalLibraryDocumentVersionSummary,
  DocumentExtractedMetadata,
} from '@shared/api.interface';
import { Button } from '@client/src/components/ui/button';
import { MetadataRevisionActions } from './MetadataRevisionActions';
import {
  enrichDocumentVersionMetadata,
  getCanonicalHostClientSessionGeneration,
} from '@client/src/api/canonical-host';

const METADATA_FIELDS: {
  key: 'title' | 'documentType' | 'issuer' | 'ata' | 'mentionedAircraftModels';
  label: string;
}[] = [
  { key: 'title', label: '标题' },
  { key: 'documentType', label: '文档类型' },
  { key: 'issuer', label: '发布方' },
  { key: 'ata', label: 'ATA' },
  { key: 'mentionedAircraftModels', label: '正文提及机型（非适用性）' },
];

export function LibraryMetadataObservations({
  metadata,
}: {
  metadata: DocumentExtractedMetadata;
}) {
  return (
    <>
      <p className="library-classification-note">
        由实际 PDF
        文本提取，全部观察值待核；“未检出”仅表示本次检查文本未发现，不代表原文没有。机型提及不构成适用性结论。
      </p>
      <dl className="library-metadata-fields">
        {METADATA_FIELDS.map(({ key, label }) => (
          <div key={key}>
            <dt>{label}</dt>
            <dd>
              {metadata[key].observations.length
                ? metadata[key].observations.map((observation, index) => (
                    <details key={`${observation.value}:${index}`}>
                      <summary>{observation.value} · 待核</summary>
                      {observation.evidence.map((evidence, evidenceIndex) => (
                        <blockquote key={evidenceIndex}>
                          <span>原文第 {evidence.page} 页</span>
                          <p>{evidence.text}</p>
                        </blockquote>
                      ))}
                    </details>
                  ))
                : '本次文本未检出'}
            </dd>
          </div>
        ))}
      </dl>
      <p className="library-classification-note">
        检查页码：{metadata.inspectedPages.join('、')} / 共 {metadata.pageCount}{' '}
        页 · 提取时间 {metadata.extractedAt}
      </p>
    </>
  );
}

export function LibraryMetadata({
  version,
  onRefresh,
}: {
  version: CanonicalLibraryDocumentVersionSummary;
  onRefresh: () => void;
}) {
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  async function enrich() {
    if (inFlight.current) return;
    inFlight.current = true;
    const generation = getCanonicalHostClientSessionGeneration();
    setPending(true);
    setMessage(null);
    setError(null);
    try {
      const receipt = await enrichDocumentVersionMetadata(
        version.documentVersionId,
      );
      if (
        !mounted.current ||
        generation !== getCanonicalHostClientSessionGeneration()
      )
        return;
      setMessage(
        receipt.disposition === 'ALREADY_PRESENT'
          ? '已有提取记录，正在刷新目录。'
          : '元数据已保存，正在刷新目录；观察值仍待核。',
      );
      onRefresh();
    } catch (reason: unknown) {
      if (
        !mounted.current ||
        generation !== getCanonicalHostClientSessionGeneration()
      )
        return;
      setError(
        `补提取未确认完成：${reason instanceof Error ? reason.message : '请求失败'}。请刷新查看保存结果后再重试。`,
      );
    } finally {
      inFlight.current = false;
      if (
        mounted.current &&
        generation === getCanonicalHostClientSessionGeneration()
      )
        setPending(false);
    }
  }

  return (
    <section className="library-version-metadata" aria-label="版本原文元数据">
      <h4>本版本元数据</h4>
      {version.extractedMetadata ? (
        <>
          <LibraryMetadataObservations metadata={version.extractedMetadata} />
          <MetadataRevisionActions
            key={version.documentVersionId}
            documentVersionId={version.documentVersionId}
            metadataRevision={'metadataRevision' in version && typeof version.metadataRevision === 'number' ? version.metadataRevision : null}
            onRefresh={onRefresh}
            renderMetadata={(metadata) => <LibraryMetadataObservations metadata={metadata} />}
          />
        </>
      ) : (
        <>
          <p className="library-classification-note">
            本版本尚无元数据提取记录。补提取只补充本版本元数据，不新建文档或评估任务。
          </p>
          <Button
            variant="outline"
            size="sm"
            disabled={pending}
            onClick={() => {
              void enrich();
            }}
          >
            {pending ? '正在补提取…' : '从原文补提取元数据'}
          </Button>
        </>
      )}
      {message ? <p role="status">{message}</p> : null}
      {error ? <p role="alert">{error}</p> : null}
    </section>
  );
}
