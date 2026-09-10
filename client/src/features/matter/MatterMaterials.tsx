import type { MatterMaterialLink } from '@shared/matter-material.interface';
import { DocumentOriginalPreview } from '@client/src/pages/WorkspaceHomePage/DocumentOriginalPreview';
import EditMatterMaterial from './EditMatterMaterial';

const kindLabels = {
  MEMBER: '同事项成员',
  RELATED: '相关参考',
  EXPECTED: '预期资料',
} as const;
const publicationLabels = {
  PLANNED: '计划发布',
  REPORTED_PUBLISHED: '已报告发布',
  CANCELLED: '计划取消',
  UNKNOWN: '发布状态未知',
} as const;
const acquisitionLabels = {
  NOT_ACQUIRED: '尚未取得',
  PARTIALLY_ACQUIRED: '部分取得',
  ACQUIRED: '已取得',
} as const;

export default function MatterMaterials({
  materials,
  matterId,
  revision,
  disabled,
  onSaved,
}: {
  materials: MatterMaterialLink[];
  matterId: string;
  revision: number;
  disabled: boolean;
  onSaved: () => Promise<void>;
}) {
  if (!materials.length) return null;
  return (
    <section className="space-y-4" aria-label="事项材料关系">
      <h2 className="text-sm font-semibold">事项材料</h2>
      <ul className="space-y-4">
        {materials.map((material) => (
          <li
            key={material.materialId}
            className="space-y-2 border-t border-border pt-3"
          >
            <p className="text-xs text-muted-foreground">
              {kindLabels[material.kind]}
              {material.disposition === 'EXCLUDED'
                ? ' · 已按工程师调整排除'
                : ''}
            </p>
            <p className="text-sm font-medium">{material.scope}</p>
            <p className="whitespace-pre-wrap text-sm leading-7">
              {material.contribution}
            </p>
            <EditMatterMaterial
              key={`${revision}:${material.materialId}`}
              matterId={matterId}
              revision={revision}
              material={material}
              disabled={disabled}
              onSaved={onSaved}
            />
            {material.kind === 'EXPECTED' ? (
              <>
                <p className="text-sm">{material.expected.description}</p>
                <p className="text-xs text-muted-foreground">
                  {[material.expected.issuer, material.expected.documentNumber]
                    .filter(Boolean)
                    .join(' · ') || '原文尚未给出完整出版身份'}
                </p>
                <p className="text-xs text-muted-foreground">
                  {publicationLabels[material.expected.publicationStatus]} ·{' '}
                  {acquisitionLabels[material.expected.acquisitionStatus]}
                </p>
                <p className="text-sm">
                  预期作用：{material.expected.expectedContribution}
                </p>
                {material.expected.expectedDate ? (
                  <p className="text-xs text-muted-foreground">
                    原文预计：{material.expected.expectedDate}（来源时点：
                    {material.expected.sourceAsOf}）
                  </p>
                ) : null}
                {material.expected.fulfilledBy.map((source) => (
                  <div key={`${source.documentVersionId}:${source.scope}`}>
                    <p className="text-xs text-muted-foreground">
                      已匹配范围：{source.scope}
                    </p>
                    <DocumentOriginalPreview
                      documentVersionId={source.documentVersionId}
                    >
                      阅读已取得的原件
                    </DocumentOriginalPreview>
                  </div>
                ))}
                {material.basis.map((basis) => (
                  <DocumentOriginalPreview
                    key={`${basis.documentVersionId}:${basis.sourceRefId}`}
                    documentVersionId={basis.documentVersionId}
                  >
                    核对预期的来源文件
                  </DocumentOriginalPreview>
                ))}
              </>
            ) : (
              <DocumentOriginalPreview
                documentVersionId={material.documentVersionId}
              >
                阅读这份原件
              </DocumentOriginalPreview>
            )}
          </li>
        ))}
      </ul>
      <p className="text-xs leading-6 text-muted-foreground">
        材料已取得与判断已覆盖分别记录；预期资料不计为已读来源。
      </p>
    </section>
  );
}
