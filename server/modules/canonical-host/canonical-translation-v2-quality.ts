import type {
  TranslationBlockCandidateV2,
  TranslationBlockCheckV2,
  TranslationBlockProvenanceV2,
  TranslationBlockRevisionV2,
  TranslationIssueV2,
  TranslationReadingElementV2,
  TranslationSemanticBlockV2,
  TranslationSourceAnchorV2,
  TranslationSourcePlanV2,
  TranslationWorkspaceReadingV2,
  TranslationWorkspaceV2,
} from '@shared/canonical-translation-v2.interface';
import { canonicalJson } from '../action-attempt/action-attempt-envelope';

export const TRANSLATION_V2_CHECK_VERSION = 'semantic-block-check@2.0';

export interface TranslationSemanticReviewV2 {
  blockId: string;
  issues: Array<{
    code: string;
    severity: TranslationIssueV2['severity'];
    message: string;
    anchorIds: string[];
  }>;
}

/** Checks complete semantic blocks. Source fragments are never output partitions. */
export function checkTranslationBlockV2(input: {
  plan: TranslationSourcePlanV2;
  candidate: TranslationBlockCandidateV2;
  semanticReview?: {
    result: TranslationSemanticReviewV2;
    provenance: TranslationBlockProvenanceV2;
  };
}): TranslationBlockCheckV2 {
  const { plan, candidate } = input;
  const block = plan.blocks.find(
    (entry) => entry.blockId === candidate.blockId,
  );
  if (!block) throw new Error('TRANSLATION_CHECK_BLOCK_NOT_IN_PLAN');
  const anchors = plan.anchors.filter((entry) =>
    block.anchorIds.includes(entry.anchorId),
  );
  const byId = new Map(anchors.map((entry) => [entry.anchorId, entry]));
  const issues = structuredClone(block.sourceIssues);
  const add = (
    code: string,
    message: string,
    anchorIds = block.anchorIds,
    origin: TranslationIssueV2['origin'] = 'TRANSLATION',
  ) => {
    issues.push({
      code,
      severity: 'BLOCK',
      origin,
      message,
      blockIds: [block.blockId],
      anchorIds,
    });
  };
  const elements = candidate.elements;
  const references = elements.flatMap((element) => element.anchorIds);
  const unknown = references.filter((id) => !byId.has(id));
  if (unknown.length)
    add(
      'UNKNOWN_SOURCE_ANCHOR',
      '译文引用了该语义块以外的来源。',
      unknown,
      'OUTPUT_CONTRACT',
    );
  const missing = block.anchorIds.filter((id) => !references.includes(id));
  if (missing.length)
    add('SOURCE_TEXT_NOT_COVERED', '该语义块仍有未覆盖的原文。', missing);
  if (
    new Set(elements.map((element) => element.elementId)).size !==
    elements.length
  )
    add(
      'DUPLICATE_READING_ELEMENT_ID',
      '阅读元素标识重复。',
      block.anchorIds,
      'OUTPUT_CONTRACT',
    );
  for (const element of elements) {
    if (new Set(element.anchorIds).size !== element.anchorIds.length)
      add(
        'DUPLICATE_ELEMENT_ANCHOR',
        '阅读元素重复引用同一来源锚点。',
        element.anchorIds,
        'OUTPUT_CONTRACT',
      );
    const elementAnchors = element.anchorIds.flatMap((id) =>
      byId.has(id) ? [byId.get(id)!] : [],
    );
    if (!validElementStructure(block, element, elementAnchors))
      add(
        'SOURCE_STRUCTURE_BINDING_CHANGED',
        '译文改变了列表项或表格单元格等原有结构的对应关系。',
        element.anchorIds,
        'OUTPUT_CONTRACT',
      );
  }
  // Many anchors may form a natural paragraph; one anchor may be rendered in
  // several paragraphs. Check connected components once to avoid false count
  // failures when the reading layout differs from the source fragment layout.
  for (const group of connectedReadingGroups(elements, byId)) {
    const sourceText = group.anchors
      .map((anchor) => anchor.sourceText)
      .join('\n');
    const translatedText = group.elements
      .map((element) => element.translatedText)
      .join('\n');
    const scope = group.anchors.map((anchor) => anchor.anchorId);
    if (
      canonicalJson(protectedValues(sourceText)) !==
      canonicalJson(protectedValues(translatedText))
    )
      add(
        'PROTECTED_VALUE_CHANGED',
        '数值、完整日期或原文字母数字标识的值或出现次数不一致。',
        scope,
      );
    if (
      canonicalJson(measuredValues(sourceText)) !==
      canonicalJson(measuredValues(translatedText))
    )
      add(
        'NUMBER_UNIT_RELATION_CHANGED',
        '数值与单位的对应关系不一致。',
        scope,
      );
    const originalRelations = explicitChannelRelations(sourceText);
    const translatedRelations = explicitChannelRelations(translatedText);
    if (
      originalRelations.length &&
      translatedRelations.length &&
      canonicalJson(originalRelations) !== canonicalJson(translatedRelations)
    )
      add(
        'OBJECT_VALUE_RELATION_CHANGED',
        '通道对象与参数值的对应关系发生变化。',
        scope,
      );
  }
  const needsSemantic = requiresTranslationSemanticReview(block, anchors);
  const review = input.semanticReview;
  if (review) {
    if (
      review.result.blockId !== block.blockId ||
      review.result.issues.some(
        (issue) =>
          !issue.anchorIds.length ||
          issue.anchorIds.some((id) => !byId.has(id)),
      )
    )
      throw new Error('TRANSLATION_SEMANTIC_REVIEW_SCOPE_INVALID');
    for (const issue of review.result.issues)
      issues.push({
        ...issue,
        origin: 'TRANSLATION',
        blockIds: [block.blockId],
      });
  }
  return {
    schemaVersion: 'wiselink.3_1.translation_block_check.v2',
    checkVersion: TRANSLATION_V2_CHECK_VERSION,
    issues,
    semanticCheck: review
      ? 'COMPLETED'
      : needsSemantic
        ? 'PENDING'
        : 'NOT_REQUIRED',
    semanticReview: review?.provenance ?? null,
  };
}

export function requiresTranslationSemanticReview(
  block: TranslationSemanticBlockV2,
  anchors: TranslationSourceAnchorV2[],
): boolean {
  return (
    ['step', 'advisory', 'table', 'preserved_source'].includes(block.kind) ||
    anchors.some((anchor) =>
      /\b(?:not|never|unless|except|only|shall|must|if|before|after|within|minimum|maximum|less|greater)\b|\d/iu.test(
        anchor.sourceText,
      ),
    )
  );
}

function validElementStructure(
  block: TranslationSemanticBlockV2,
  element: TranslationReadingElementV2,
  anchors: TranslationSourceAnchorV2[],
): boolean {
  if (!anchors.length) return false;
  if (block.kind === 'table') {
    const cells = anchors.map((anchor) => tableCellKey(anchor));
    if (cells.some(Boolean))
      return (
        element.kind === 'table_cell' &&
        cells.every(Boolean) &&
        new Set(cells).size === 1
      );
    if (element.kind === 'table_cell') return false;
  } else if (element.kind === 'table_cell') return false;
  if (
    block.kind === 'list' &&
    anchors.some((anchor) =>
      block.sourceStructure.some(
        (unit) =>
          unit.sourceUnitId === anchor.sourceUnitId &&
          unit.kind === 'list_item',
      ),
    )
  ) {
    return (
      element.kind === 'list_item' &&
      new Set(anchors.map((anchor) => anchor.sourceUnitId)).size === 1
    );
  }
  return true;
}

export function tableCellKey(anchor: TranslationSourceAnchorV2): string | null {
  const match =
    /^(\/payload\/rowGroups\/\d+\/rows\/\d+\/cells\/\d+)\/inlineContent\//u.exec(
      anchor.payloadPath,
    );
  return match ? `${anchor.sourceUnitId}:${match[1]}` : null;
}

function connectedReadingGroups(
  elements: TranslationReadingElementV2[],
  anchors: Map<string, TranslationSourceAnchorV2>,
) {
  const pending = new Set(elements.map((_element, index) => index));
  const groups: Array<{
    anchors: TranslationSourceAnchorV2[];
    elements: TranslationReadingElementV2[];
  }> = [];
  while (pending.size) {
    const indices = new Set([pending.values().next().value as number]);
    const ids = new Set<string>();
    let expanded = true;
    while (expanded) {
      expanded = false;
      for (const index of pending) {
        if (
          indices.has(index) ||
          elements[index].anchorIds.some((id) => ids.has(id))
        ) {
          if (!indices.has(index)) expanded = true;
          indices.add(index);
          for (const id of elements[index].anchorIds) {
            if (!ids.has(id)) expanded = true;
            ids.add(id);
          }
        }
      }
    }
    indices.forEach((index) => pending.delete(index));
    groups.push({
      elements: [...indices]
        .sort((a, b) => a - b)
        .map((index) => elements[index]),
      anchors: [...anchors.values()].filter((anchor) =>
        ids.has(anchor.anchorId),
      ),
    });
  }
  return groups;
}

const months = [
  'january',
  'february',
  'march',
  'april',
  'may',
  'june',
  'july',
  'august',
  'september',
  'october',
  'november',
  'december',
];
function calendarDate(year: string, month: number, day: string): string | null {
  const date = new Date(Date.UTC(Number(year), month - 1, Number(day)));
  return date.getUTCFullYear() === Number(year) &&
    date.getUTCMonth() + 1 === month &&
    date.getUTCDate() === Number(day)
    ? `${year}-${month}-${Number(day)}`
    : null;
}
function normalizedDates(value: string): { text: string; dates: string[] } {
  const dates: string[] = [];
  const replace = (
    original: string,
    year: string,
    month: number,
    day: string,
  ) => {
    const date = calendarDate(year, month, day);
    if (!date) return original;
    dates.push(date);
    return ' ';
  };
  const monthNumber = (name: string) =>
    months.findIndex((month) =>
      month.startsWith(name.toLowerCase().replace(/\.$/u, '')),
    ) + 1;
  const names =
    '(January|February|March|April|May|June|July|August|September|October|November|December|Jan\\.?|Feb\\.?|Mar\\.?|Apr\\.?|Jun\\.?|Jul\\.?|Aug\\.?|Sep\\.?|Sept\\.?|Oct\\.?|Nov\\.?|Dec\\.?)';
  const text = value
    .replace(
      new RegExp(`\\b${names}\\s+(\\d{1,2}),?\\s+(\\d{4})\\b`, 'giu'),
      (all, month, day, year) => replace(all, year, monthNumber(month), day),
    )
    .replace(
      new RegExp(`\\b(\\d{1,2})\\s+${names},?\\s+(\\d{4})\\b`, 'giu'),
      (all, day, month, year) => replace(all, year, monthNumber(month), day),
    )
    .replace(/\b(\d{4})-(\d{2})-(\d{2})\b/gu, (all, year, month, day) =>
      replace(all, year, Number(month), day),
    )
    .replace(
      /(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日/gu,
      (all, year, month, day) => replace(all, year, Number(month), day),
    );
  return { text, dates: dates.sort() };
}
function protectedValues(value: string) {
  const normalized = normalizedDates(value);
  // Preserve literal identifiers, including O/0 and punctuation; never infer an
  // OCR correction. Ordinary unambiguous quantities allow leading-zero format.
  const identifiers = [
    ...normalized.text.matchAll(
      /\b(?=[A-Za-z0-9./-]*[A-Za-z])(?=[A-Za-z0-9./-]*\d)[A-Za-z0-9]+(?:[-./][A-Za-z0-9]+)*\b/gu,
    ),
  ]
    .map((match) => match[0])
    .sort();
  const numbers = [...normalized.text.matchAll(/\d+(?:\.\d+)?/gu)]
    .map((match) => String(Number(match[0])))
    .sort();
  return { dates: normalized.dates, identifiers, numbers };
}
const unitNames: Record<string, string> = {
  s: 's',
  sec: 's',
  second: 's',
  seconds: 's',
  秒: 's',
  min: 'min',
  minute: 'min',
  minutes: 'min',
  分钟: 'min',
  h: 'h',
  hr: 'h',
  hour: 'h',
  hours: 'h',
  小时: 'h',
  mm: 'mm',
  毫米: 'mm',
  cm: 'cm',
  厘米: 'cm',
  kg: 'kg',
  千克: 'kg',
  psi: 'psi',
  kpa: 'kPa',
  '%': '%',
};
const measuredPattern =
  /(\d+(?:\.\d+)?)\s*(seconds?\b|sec\b|s\b|minutes?\b|min\b|hours?\b|hr\b|h\b|mm\b|cm\b|kg\b|psi\b|kpa\b|分钟|小时|千克|毫米|厘米|秒|%)/giu;
function measuredValues(value: string) {
  return [...value.matchAll(measuredPattern)]
    .map((match) => `${Number(match[1])}:${unitNames[match[2].toLowerCase()]}`)
    .sort();
}
function explicitChannelRelations(value: string) {
  return [
    ...value.matchAll(
      /(?:channel\s+([AB])\b|\b([AB])\s+channel\b|通道\s*([AB])|([AB])\s*通道)[^.;。；\n]{0,50}?(\d+(?:\.\d+)?)\s*(seconds?\b|s\b|minutes?\b|min\b|psi\b|秒|分钟)/giu,
    ),
  ]
    .map(
      (match) =>
        `${(match[1] ?? match[2] ?? match[3] ?? match[4]).toUpperCase()}:${Number(match[5])}:${unitNames[match[6].toLowerCase()]}`,
    )
    .sort();
}

/** Derives reading coverage from actual immutable bodies and their saved checks. */
export function buildTranslationWorkspaceReadingV2(
  workspace: TranslationWorkspaceV2,
  revisions: TranslationBlockRevisionV2[],
): TranslationWorkspaceReadingV2 {
  const plan = workspace.plan;
  const applicable = revisions.filter(
    (revision) =>
      revision.workspaceId === workspace.workspaceId &&
      revision.planRevision === plan.planRevision &&
      revision.dependencies.contextRevision === plan.documentContext.revision &&
      revision.dependencies.methodVersion === workspace.methodVersion,
  );
  const blocks: TranslationWorkspaceReadingV2['blocks'] = plan.blocks.map(
    (source) => {
      const blockRevisions = applicable
        .filter((revision) => revision.blockId === source.blockId)
        .sort((a, b) => b.contentRevision - a.contentRevision);
      const selectedRevisions = blockRevisions.filter(
        (revision) => revision.selectedForReading,
      );
      if (selectedRevisions.length > 1)
        throw new Error('TRANSLATION_MULTIPLE_SELECTED_REVISIONS');
      const selected = selectedRevisions[0] ?? null;
      if (
        selected &&
        (!selected.check ||
          selected.check.semanticCheck === 'PENDING' ||
          selected.check.issues.some((issue) => issue.severity === 'BLOCK'))
      )
        throw new Error('TRANSLATION_SELECTED_REVISION_NOT_READABLE');
      const latest = blockRevisions[0];
      return {
        source,
        selected,
        readingStatus: selected
          ? 'READABLE'
          : source.sourceIssues.some((issue) => issue.severity === 'BLOCK')
            ? 'BLOCKED'
            : !latest
              ? 'MISSING'
              : latest.check?.issues.some((issue) => issue.severity === 'BLOCK')
                ? 'BLOCKED'
                : 'PENDING_CHECK',
        issues: structuredClone(
          selected?.check?.issues ??
            latest?.check?.issues ??
            source.sourceIssues,
        ),
      };
    },
  );
  const savedIds = new Set(applicable.map((revision) => revision.blockId));
  const readableIds = new Set(
    blocks
      .filter((block) => block.readingStatus === 'READABLE')
      .map((block) => block.source.blockId),
  );
  const complete = blocks.every((block) => block.readingStatus === 'READABLE');
  return {
    schemaVersion: 'wiselink.3_1.translation_workspace_reading.v2',
    workspaceId: workspace.workspaceId,
    rowVersion: workspace.rowVersion,
    candidateOnly: true,
    source: structuredClone(plan.source),
    completeness: !complete
      ? 'PARTIAL'
      : blocks.some((block) =>
            block.issues.some((issue) => issue.severity === 'REVIEW'),
          )
        ? 'COMPLETE_WITH_ISSUES'
        : 'COMPLETE',
    anchors: structuredClone(plan.anchors),
    blocks,
    coverage: {
      registeredSourceCharacters: plan.blocks.reduce(
        (sum, block) => sum + block.sourceCharacterCount,
        0,
      ),
      savedSourceCharacters: plan.blocks
        .filter((block) => savedIds.has(block.blockId))
        .reduce((sum, block) => sum + block.sourceCharacterCount, 0),
      readableSourceCharacters: blocks
        .filter((block) => block.readingStatus === 'READABLE')
        .reduce((sum, block) => sum + block.source.sourceCharacterCount, 0),
      sourceUnitCount: plan.inventory.length,
      unresolvedSourceUnitCount: plan.inventory.filter(
        (unit) => !readableIds.has(unit.blockId),
      ).length,
      missingBlockCount: blocks.filter(
        (block) => block.readingStatus === 'MISSING',
      ).length,
      pendingCheckBlockCount: blocks.filter(
        (block) => block.readingStatus === 'PENDING_CHECK',
      ).length,
      blockedBlockCount: blocks.filter(
        (block) => block.readingStatus === 'BLOCKED',
      ).length,
    },
    finalCandidate:
      workspace.resultArtifact && workspace.resultManifest
        ? {
            artifact: structuredClone(workspace.resultArtifact),
            manifest: structuredClone(workspace.resultManifest),
          }
        : null,
  };
}
