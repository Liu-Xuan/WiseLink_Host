import { Link } from 'react-router-dom';

import { Badge } from '@client/src/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@client/src/components/ui/card';
import { exactDocumentSourceRoute } from '@client/src/features/matter/matter-navigation';
import type { DocumentOriginalBinding } from '@shared/document-original.interface';
import type {
  DocumentRevisionReadingSide,
  DocumentRevisionSectionReading,
} from '@shared/document-revision-reading.interface';
import type { TranslationStructuredSourceUnit } from '@shared/canonical-translation-v2.interface';
import type { DocumentSemanticSection } from '@shared/document-semantic-map.interface';

export interface DocumentRevisionReadingSidePanelProps {
  sideLabel: string;
  side: DocumentRevisionReadingSide;
  returnParamsFor?: (binding: DocumentOriginalBinding) => string | null;
}

const CONTENT_STATE_LABEL: Record<DocumentSemanticSection['contentState'], string> = {
  CONTENT: '正文',
  EXPLICIT_NONE: '原文明示无',
  EXPLICIT_NA: '原文明示不适用',
  EMPTY: '空',
  UNREAD: '未读',
};

function unitText(unit: TranslationStructuredSourceUnit): string | null {
  const text: unknown = unit.payload.text;
  return typeof text === 'string' && text.trim() ? text : null;
}

interface RevisionTableCell {
  cellId: string;
  isHeader?: boolean;
  rowSpan: number;
  colSpan: number;
  inlineContent: Array<{ text: string }>;
}

interface RevisionTableRow {
  rowId: string;
  cells: RevisionTableCell[];
}

interface RevisionTableRowGroup {
  rows: RevisionTableRow[];
}

function RevisionTable({ payload }: { payload: Record<string, unknown> }) {
  const groups: RevisionTableRowGroup[] = Array.isArray(payload.rowGroups)
    ? (payload.rowGroups as RevisionTableRowGroup[])
    : [];
  const caption: string | null =
    typeof payload.caption === 'string' && payload.caption
      ? payload.caption
      : null;
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-xs">
        {caption ? (
          <caption className="px-2 py-1 text-left text-muted-foreground">
            {caption}
          </caption>
        ) : null}
        <tbody>
          {groups
            .flatMap((group: RevisionTableRowGroup) => group.rows)
            .map((row: RevisionTableRow) => (
              <tr key={row.rowId}>
                {row.cells.map((cell: RevisionTableCell) => {
                  const CellTag = cell.isHeader ? 'th' : 'td';
                  const inline: Array<{ text: string }> = Array.isArray(
                    cell.inlineContent,
                  )
                    ? cell.inlineContent
                    : [];
                  return (
                    <CellTag
                      key={cell.cellId}
                      rowSpan={cell.rowSpan}
                      colSpan={cell.colSpan}
                      className="border border-border px-2 py-1 text-left align-top"
                    >
                      {inline.map((item: { text: string }) => item.text).join(' ')}
                    </CellTag>
                  );
                })}
              </tr>
            ))}
        </tbody>
      </table>
    </div>
  );
}

function readingImpactLabel(
  readingImpact: 'DIAGNOSTIC' | 'LIMITATION' | undefined,
): string {
  if (readingImpact === 'DIAGNOSTIC') return '诊断';
  if (readingImpact === 'LIMITATION') return '限制';
  return '未标注';
}

function buildSourceRoute(
  binding: DocumentOriginalBinding,
  sourceRefId: string,
  returnParamsFor?: (binding: DocumentOriginalBinding) => string | null,
): string | null {
  const route: string | null = exactDocumentSourceRoute({
    documentVersionId: binding.documentVersionId,
    sourceRefId,
    locator: JSON.stringify({
      parseRunId: binding.parseRunId,
      sourceRefId,
    }),
  });
  if (!route) return null;
  const returnParams: string | null = returnParamsFor?.(binding) ?? null;
  return returnParams ? `${route}&${returnParams}` : route;
}

function SourceRefLinks({
  sourceRefIds,
  binding,
  returnParamsFor,
}: {
  sourceRefIds: string[];
  binding: DocumentOriginalBinding;
  returnParamsFor?: (binding: DocumentOriginalBinding) => string | null;
}) {
  if (sourceRefIds.length === 0) return null;
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      {sourceRefIds.map((sourceRefId: string) => {
        const route: string | null = buildSourceRoute(
          binding,
          sourceRefId,
          returnParamsFor,
        );
        return route ? (
          <Link
            key={sourceRefId}
            to={route}
            className="rounded border border-border px-1.5 py-0.5 text-xs text-primary hover:bg-muted"
          >
            原文 {sourceRefId}
          </Link>
        ) : (
          <span
            key={sourceRefId}
            className="rounded border border-border px-1.5 py-0.5 text-xs text-muted-foreground"
            title="该来源无法构造精确定位链接，仅展示来源标识"
          >
            来源 {sourceRefId}
          </span>
        );
      })}
    </span>
  );
}

function SectionReadingBlock({
  sectionReading,
  binding,
  returnParamsFor,
}: {
  sectionReading: DocumentRevisionSectionReading;
  binding: DocumentOriginalBinding;
  returnParamsFor?: (binding: DocumentOriginalBinding) => string | null;
}) {
  const contextUnitIds: Set<string> = new Set(
    sectionReading.selection.contextUnitIds,
  );
  const orderedUnits: TranslationStructuredSourceUnit[] = [...sectionReading.units].sort(
    (a: TranslationStructuredSourceUnit, b: TranslationStructuredSourceUnit) =>
      a.order - b.order,
  );
  const contextUnits: TranslationStructuredSourceUnit[] = orderedUnits.filter(
    (unit: TranslationStructuredSourceUnit) => contextUnitIds.has(unit.unitId),
  );
  const bodyUnits: TranslationStructuredSourceUnit[] = orderedUnits.filter(
    (unit: TranslationStructuredSourceUnit) => !contextUnitIds.has(unit.unitId),
  );
  const renderUnits = (
    units: TranslationStructuredSourceUnit[],
    emptyText: string,
  ) =>
    units.length === 0 ? (
      <p className="text-xs text-muted-foreground">{emptyText}</p>
    ) : (
      <ul className="space-y-2">
        {units.map((unit: TranslationStructuredSourceUnit) => {
          const text: string | null = unitText(unit);
          return (
            <li key={unit.unitId} className="text-sm">
              {unit.kind === 'table' ? (
                <RevisionTable payload={unit.payload} />
              ) : text ? (
                <p className="whitespace-pre-wrap text-foreground">{text}</p>
              ) : (
                <p className="text-xs text-muted-foreground">
                  非纯文本单元（{unit.kind}），不参与文本比较，内容以原文为准。
                </p>
              )}
              <SourceRefLinks
                sourceRefIds={unit.sourceRefIds}
                binding={binding}
                returnParamsFor={returnParamsFor}
              />
            </li>
          );
        })}
      </ul>
    );
  return (
    <div className="space-y-2 rounded-md border border-border/60 p-3">
      {contextUnits.length > 0 ? (
        <div className="space-y-1">
          <p className="text-xs font-medium text-muted-foreground">
            父级条件（所选章节之外的祖先条件）
          </p>
          {renderUnits(contextUnits, '无父级条件。')}
        </div>
      ) : null}
      <div className="space-y-1">
        <p className="text-xs font-medium text-muted-foreground">正文</p>
        {renderUnits(bodyUnits, '该章节无正文单元。')}
      </div>
      {sectionReading.selection.unresolvedRanges.length > 0 ? (
        <p className="text-xs text-muted-foreground">
          本选择有 {sectionReading.selection.unresolvedRanges.length}{' '}
          项覆盖记录（含诊断或未标注项），详见下方逐项性质；数量不代表未读或比较失败。
        </p>
      ) : null}
    </div>
  );
}

export default function DocumentRevisionReadingSidePanel({
  sideLabel,
  side,
  returnParamsFor,
}: DocumentRevisionReadingSidePanelProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{sideLabel}</CardTitle>
        <p className="text-xs text-muted-foreground">
          DV {side.binding.documentVersionId} · parseRun {side.binding.parseRunId} ·
          解析修订 {side.binding.parseRevision} · 语义修订 {side.semanticRevision} ·
          profile {side.profileRef}
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <section className="space-y-2">
          <h3 className="text-sm font-medium text-foreground">厂家改版说明</h3>
          {side.publisherRevisionDescriptions.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              未定位到支持的说明角色；不代表该版本没有改版说明。
            </p>
          ) : (
            side.publisherRevisionDescriptions.map(
              (description: DocumentRevisionSectionReading, index: number) => (
                <SectionReadingBlock
                  key={`publisher-${index}`}
                  sectionReading={description}
                  binding={side.binding}
                  returnParamsFor={returnParamsFor}
                />
              ),
            )
          )}
        </section>
        <section className="space-y-2">
          <h3 className="text-sm font-medium text-foreground">
            所选角色正文与父级条件
          </h3>
          {side.selectedSections.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              本端未返回所选章节内容；原因见系统比较说明。
            </p>
          ) : (
            side.selectedSections.map(
              (selected: DocumentRevisionSectionReading, index: number) => (
                <SectionReadingBlock
                  key={`selected-${selected.selection.sectionId}-${index}`}
                  sectionReading={selected}
                  binding={side.binding}
                  returnParamsFor={returnParamsFor}
                />
              ),
            )
          )}
        </section>
        <section className="space-y-2">
          <h3 className="text-sm font-medium text-foreground">章节与角色</h3>
          {side.sections.length === 0 ? (
            <p className="text-sm text-muted-foreground">本端无章节组织。</p>
          ) : (
            <ul className="space-y-1">
              {side.sections.map((section: DocumentSemanticSection) => (
                <li
                  key={section.sectionId}
                  className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground"
                >
                  <span className="text-foreground">{section.titleRaw}</span>
                  {section.roleKey ? (
                    <Badge variant="outline">role {section.roleKey}</Badge>
                  ) : (
                    <Badge variant="secondary">无 role</Badge>
                  )}
                  <span>{CONTENT_STATE_LABEL[section.contentState]}</span>
                  <SourceRefLinks
                    sourceRefIds={section.sourceRefIds}
                    binding={side.binding}
                    returnParamsFor={returnParamsFor}
                  />
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className="space-y-2">
          <h3 className="text-sm font-medium text-foreground">未比较与覆盖限制</h3>
          <p className="text-sm text-muted-foreground">
            未参与本次比较的单元：{side.unselectedUnitIds.length} 个。
          </p>
          {side.coverage.unresolvedRanges.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              原文覆盖：无未解析范围记录。
            </p>
          ) : (
            <ul className="space-y-1.5">
              {side.coverage.unresolvedRanges.map(
                (
                  range: (typeof side.coverage.unresolvedRanges)[number],
                  index: number,
                ) => (
                  <li
                    key={index}
                    className="space-y-0.5 text-xs text-muted-foreground"
                  >
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Badge variant="outline">
                        {readingImpactLabel(range.readingImpact)}
                      </Badge>
                      <span className="text-foreground">{range.reason}</span>
                      <span>{range.message}</span>
                    </div>
                    {range.pageIndexes.length > 0 || range.unitIds.length > 0 ? (
                      <div className="flex flex-wrap gap-x-3 gap-y-0.5">
                        {range.pageIndexes.length > 0 ? (
                          <span>
                            页：
                            {range.pageIndexes
                              .map((page: number) => page + 1)
                              .join('、')}
                          </span>
                        ) : null}
                        {range.unitIds.length > 0 ? (
                          <span>单元：{range.unitIds.join('、')}</span>
                        ) : null}
                      </div>
                    ) : null}
                  </li>
                ),
              )}
            </ul>
          )}
        </section>
      </CardContent>
    </Card>
  );
}
