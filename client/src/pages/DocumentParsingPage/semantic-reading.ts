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
  BLOCKED: '中文暂不可用',
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
            ? `第 ${locator.pageStart + (locator.kind === 'PDF_PAGE' ? 1 : 0)}${locator.pageEnd != null && locator.pageEnd !== locator.pageStart ? '–' + (locator.pageEnd + (locator.kind === 'PDF_PAGE' ? 1 : 0)) : ''} 页`
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
    `中文可读覆盖的原文范围 ${reading.coverage.readableSourceCharacters}/${reading.coverage.registeredSourceCharacters} 字符；未覆盖来源单元 ${reading.coverage.unresolvedSourceUnitCount}。`,
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
        `语义范围：${block.source.blockId} · 译文修订 ${block.selected.contentRevision} · ${block.selected.blockRevisionId}`,
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
      ...semanticReadingIssues(block).map(
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

/** Engineering projection also supports already-saved workspaces; raw checks remain server diagnostics. */
export function semanticReadingIssues(block: SemanticReadingBlock): TranslationIssueV2[] {
  const messages: Record<string, string> = {
    PROTECTED_VALUE_CHANGED: '本段中文的数值、日期或标识尚未与原文一致，请以原文为准。',
    DATE_FIELD_RELATION_CHANGED: '本段中文的日期归属尚未与原文一致，请以原文为准。',
    FIGURE_TEXT_COVERAGE_UNVERIFIED: '图内文字或关系尚未读取，可查看对应原图。',
    SOURCE_STRUCTURE_PRESERVED_AS_TEXT: '此处版式关系尚未可靠重建，可查看对应原页。',
    SOURCE_MAPPING_REQUIRES_REVIEW: '此处来源对应关系尚不完整，可查看对应原页。',
    SOURCE_TEXT_UNAVAILABLE: '此范围尚无可供翻译的原文字，请查看原页。',
  };
  const seen = new Set<string>();
  return block.issues.flatMap(issue => {
    if (issue.origin === 'SOURCE' && issue.readingImpact !== 'LIMITATION' && (['TEXT_CONFLICT', 'FIGURE_UNINTERPRETED'].includes(issue.code) ||
      (issue.code === 'STRUCTURE_UNCERTAIN' && !['table', 'preserved_source'].includes(block.source.kind)))) return [];
    const message = messages[issue.code] ?? (issue.origin === 'OUTPUT_CONTRACT' || issue.origin === 'SERVICE'
      ? '本段中文尚未通过必要检查，可继续阅读对应原文。'
      : issue.message.includes('{') || /JSON|anchorId|blockId|请.*恢复遗漏/.test(issue.message)
        ? '本段中文尚未与对应原文一致，请以原文为准。' : issue.message);
    const key = `${issue.origin}:${message}`;
    if (seen.has(key)) return [];
    seen.add(key);
    return [{ ...issue, message }];
  });
}

export function semanticReadingExport(reading: TranslationWorkspaceReadingV2) {
  return {
    schemaVersion: 'wiselink.3_1.bilingual_reading_export.v2',
    candidateOnly: true, scope: reading.completeness, workspaceId: reading.workspaceId,
    rowVersion: reading.rowVersion, source: reading.source, coverage: reading.coverage, anchors: reading.anchors,
    blocks: reading.blocks.map(block => ({
      source: { ...block.source, sourceIssues: semanticReadingIssues({ ...block, issues: block.source.sourceIssues }) },
      readingStatus: block.readingStatus, issues: semanticReadingIssues(block),
      selected: block.selected ? { contentRevision: block.selected.contentRevision,
        blockRevisionId: block.selected.blockRevisionId, candidate: block.selected.candidate } : null,
    })),
    readingText: semanticReadingText(reading),
  };
}
