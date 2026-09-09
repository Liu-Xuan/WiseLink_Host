import type {
  TranslationIssueV2,
  TranslationSourceAnchorV2,
  TranslationWorkspaceReadingV2,
} from '@shared/canonical-translation-v2.interface';

export type SemanticReadingBlock =
  TranslationWorkspaceReadingV2['blocks'][number];
export type SemanticReadingMode = 'translation' | 'original' | 'bilingual';

export const semanticReadingStatusLabels = {
  MISSING: '待生成',
  PENDING_CHECK: '已保存，待检查',
  READABLE: '可读候选',
  BLOCKED: '需处理',
} as const;

export const translationIssueOriginLabels: Record<
  TranslationIssueV2['origin'],
  string
> = {
  SOURCE: '原文 / 提取',
  TRANSLATION: '翻译',
  OUTPUT_CONTRACT: '输出结构',
  SERVICE: '执行服务',
};

export function semanticSourceLinks(anchors: TranslationSourceAnchorV2[]) {
  const links = new Map<
    string,
    {
      anchor: TranslationSourceAnchorV2;
      ref: string;
      label: string;
    }
  >();
  for (const anchor of anchors) {
    for (const ref of anchor.sourceRefIds) {
      if (links.has(ref)) continue;
      const locator = anchor.sourceLocators.find(
        (entry) => entry.sourceRefId === ref,
      );
      links.set(ref, {
        anchor,
        ref,
        label:
          locator?.pageStart != null
            ? `第 ${locator.pageStart}${locator.pageEnd != null && locator.pageEnd !== locator.pageStart ? '–' + locator.pageEnd : ''} 页`
            : `来源 ${links.size + 1}（无精确页码）`,
      });
    }
  }
  return [...links.values()];
}

/** Formatting only: the denominator is the Host's registered source text. */
export function semanticReadingCoverage(
  reading: TranslationWorkspaceReadingV2,
) {
  const coverage = reading.coverage;
  const registered = coverage.registeredSourceCharacters;
  const ratio = (characters: number): number | null =>
    registered > 0
      ? Math.min(100, Math.max(0, (characters / registered) * 100))
      : null;
  return {
    savedPercent: ratio(coverage.savedSourceCharacters),
    readablePercent: ratio(coverage.readableSourceCharacters),
    scope:
      reading.completeness === 'PARTIAL'
        ? '部分译文候选'
        : reading.completeness === 'COMPLETE_WITH_ISSUES'
          ? '完整译文候选 · 有待复核项'
          : '完整译文候选',
    delivery: reading.finalCandidate
      ? '完整候选产物已保存'
      : '尚未形成完整交付产物',
    missing: reading.blocks.filter(
      (block) => block.readingStatus !== 'READABLE',
    ),
  };
}

/** Include whole semantic groups, source conditions, versions and all gaps. */
export function semanticReadingText(
  reading: TranslationWorkspaceReadingV2,
): string {
  const status = semanticReadingCoverage(reading);
  const lines: string[] = [
    `双语阅读候选 · ${status.scope}`,
    `文件版本：${reading.source.documentVersionId}`,
    `工作区：${reading.workspaceId} · 读取版本 ${reading.rowVersion}`,
    `可读原文范围 ${reading.coverage.readableSourceCharacters}/${reading.coverage.registeredSourceCharacters} 字符；未覆盖来源单元 ${reading.coverage.unresolvedSourceUnitCount}。`,
    status.delivery,
    '包含完整语义段落 / 表格组及其条件和缺项；仅供阅读参考，不构成正式采用。',
    '',
  ];
  for (const block of [...reading.blocks].sort(
    (a, b) => a.source.order - b.source.order,
  )) {
    const anchors = reading.anchors.filter((anchor) =>
      block.source.anchorIds.includes(anchor.anchorId),
    );
    lines.push(
      `${semanticReadingStatusLabels[block.readingStatus]} · ${semanticSourceLinks(
        anchors,
      )
        .map((entry) => entry.label)
        .join('、')}`,
    );
    if (block.selected) {
      lines.push(
        `语义范围：${block.source.blockId} · 正文版本 ${block.selected.contentRevision} · ${block.selected.blockRevisionId}`,
      );
      lines.push(
        '译文：',
        ...block.selected.candidate.elements.map(
          (element) => element.translatedText,
        ),
      );
    } else lines.push('【此范围无可读译文】');
    lines.push(
      '对应原文（含表头、条件及脚注）：',
      ...anchors.map((anchor) => anchor.sourceText),
    );
    lines.push(
      ...block.issues.map(
        (issue) =>
          `${translationIssueOriginLabels[issue.origin]} · ${issue.severity}：${issue.message}`,
      ),
      '',
    );
  }
  lines.push(
    '缺项清单：',
    ...(status.missing.length
      ? status.missing.map(
          (block) =>
            `${block.source.blockId} · ${semanticReadingStatusLabels[block.readingStatus]}`,
        )
      : ['无未覆盖语义范围。']),
  );
  return lines.join('\n');
}
