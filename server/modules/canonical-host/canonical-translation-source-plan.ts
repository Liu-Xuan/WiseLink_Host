import type { UnifiedPackageArtifactDescriptor } from '@shared/api.interface';
import type {
  TranslationIssueV2,
  TranslationSemanticBlockV2,
  TranslationSourceAnchorV2,
  TranslationSourcePlanV2,
  TranslationStructuredSource,
  TranslationStructuredSourceUnit,
} from '@shared/canonical-translation-v2.interface';
import {
  canonicalJson,
  recordArray,
  recordValue,
  stringArray,
} from '../unified-reader/unified-reader.utils';

/** Organizes fully validated source; it neither rewrites OCR nor infers PDF coordinates. */
export function buildTranslationSourcePlan(input: {
  documentVersionId: string;
  packageId: string;
  parsedArtifact: UnifiedPackageArtifactDescriptor;
  title: string;
  source: TranslationStructuredSource;
  planRevision?: number;
}): TranslationSourcePlanV2 {
  const units = readingOrder(input.source);
  const byId = new Map(units.map((unit) => [unit.unitId, unit]));
  const locators = new Map(
    input.source.sourceLocators.map((locator) => [
      locator.sourceRefId,
      locator,
    ]),
  );
  const anchors: TranslationSourceAnchorV2[] = [];
  const anchorsByUnit = new Map<string, TranslationSourceAnchorV2[]>();
  for (const unit of units) {
    const unitAnchors = sourceTextFields(unit).map((field) => {
      const anchor: TranslationSourceAnchorV2 = {
        anchorId: `a${anchors.length + 1}`,
        sourceUnitId: unit.unitId,
        payloadPath: field.path,
        sourceText: field.text,
        sourceRefIds: [...field.sourceRefIds],
        sourceLocators: field.sourceRefIds.map((id) => {
          const locator = locators.get(id);
          if (!locator)
            throw new Error('TRANSLATION_PLAN_SOURCE_LOCATOR_MISSING');
          return structuredClone(locator);
        }),
      };
      anchors.push(anchor);
      return anchor;
    });
    anchorsByUnit.set(unit.unitId, unitAnchors);
  }

  const blocks: TranslationSemanticBlockV2[] = [];
  const assigned = new Map<string, string>();
  for (let index = 0; index < units.length; index += 1) {
    const first = units[index];
    if (assigned.has(first.unitId)) continue;
    const group = [first];
    let organization: TranslationSemanticBlockV2['organization'] =
      'ORIGINAL_UNIT';
    if (first.kind === 'paragraph') {
      // Preserve unfinished sentences across extraction fragments, but do not
      // turn a whole section into an unbounded block. This is a scheduling
      // target at a sentence boundary, never a character-level text cut.
      for (
        let nextIndex = index + 1;
        nextIndex < units.length;
        nextIndex += 1
      ) {
        const next = units[nextIndex];
        if (
          assigned.has(next.unitId) ||
          next.kind !== 'paragraph' ||
          next.moduleId !== first.moduleId ||
          next.parentUnitId !== first.parentUnitId ||
          next.payload.role !== first.payload.role
        )
          break;
        const accumulated = group.flatMap(unit => anchorsByUnit.get(unit.unitId) ?? []);
        const lastText = accumulated.at(-1)?.sourceText.trim() ?? '';
        const nextText = (anchorsByUnit.get(next.unitId) ?? [])[0]?.sourceText.trim() ?? '';
        if (accumulated.reduce((total, anchor) => total + anchor.sourceText.length, 0) >= 6000 &&
            /[.!?]["')\]]?$/.test(lastText) &&
            !/^(unless|except|provided|whereas|otherwise)\b/i.test(nextText)) break;
        group.push(next);
      }
      if (group.length > 1) organization = 'ADJACENT_PROSE_CONTEXT';
    } else if (first.kind === 'list') {
      const collect = (
        list: TranslationStructuredSourceUnit,
        stack: Set<string>,
      ): void => {
        if (stack.has(list.unitId))
          throw new Error('TRANSLATION_PLAN_LIST_CYCLE');
        const path = new Set([...stack, list.unitId]);
        for (const id of stringArray(
          list.payload.itemUnitIds,
          'list.itemUnitIds',
        )) {
          const item = byId.get(id);
          if (
            !item ||
            item.moduleId !== first.moduleId ||
            assigned.has(id) ||
            group.includes(item)
          ) {
            throw new Error('TRANSLATION_PLAN_LIST_MEMBER_INVALID');
          }
          group.push(item);
          if (item.kind === 'list') collect(item, path);
        }
      };
      collect(first, new Set());
      organization = 'EXPLICIT_LIST';
    } else if (first.kind === 'table' && tableContinuation(first)) {
      for (
        let nextIndex = index + 1;
        nextIndex < units.length;
        nextIndex += 1
      ) {
        const next = units[nextIndex];
        if (
          assigned.has(next.unitId) ||
          next.kind !== 'table' ||
          next.moduleId !== first.moduleId ||
          next.parentUnitId !== first.parentUnitId ||
          !compatibleTableContinuation(first, next)
        )
          break;
        group.push(next);
      }
      if (group.length > 1) organization = 'EXPLICIT_TABLE_CONTINUATION';
    }
    const blockAnchors = group.flatMap(
      (unit) => anchorsByUnit.get(unit.unitId)!,
    );
    const block: TranslationSemanticBlockV2 = {
      blockId: `b${blocks.length + 1}`,
      order: blocks.length,
      kind: blockKind(first.kind),
      moduleId: first.moduleId,
      sourceUnitIds: group.map((unit) => unit.unitId),
      anchorIds: blockAnchors.map((anchor) => anchor.anchorId),
      sourceStructure: group.map((unit) => ({
        sourceUnitId: unit.unitId,
        kind: unit.kind,
        payload: structuredClone(unit.payload),
      })),
      contextBlockIds: [],
      requiredTogetherBlockIds: [],
      sourceCharacterCount: blockAnchors.reduce(
        (total, anchor) => total + [...anchor.sourceText].length,
        0,
      ),
      sourceIssues: [],
      organization,
    };
    for (const unit of group) {
      if (assigned.has(unit.unitId))
        throw new Error('TRANSLATION_PLAN_DUPLICATE_SOURCE_UNIT');
      assigned.set(unit.unitId, block.blockId);
    }
    blocks.push(block);
  }

  const byBlockId = new Map(blocks.map((block) => [block.blockId, block]));
  const outline: TranslationSourcePlanV2['documentContext']['outline'] = [];
  const headingPath = new Map<
    string,
    Array<{ level: number; blockId: string }>
  >();
  for (const block of blocks) {
    const first = byId.get(block.sourceUnitIds[0])!;
    const path = headingPath.get(first.moduleId) ?? [];
    if (first.kind === 'heading') {
      const level = finiteInteger(first.payload.level, 'heading.level');
      while (path.length && path[path.length - 1].level >= level) path.pop();
      outline.push({
        blockId: block.blockId,
        anchorIds: block.anchorIds,
        level,
      });
      block.contextBlockIds.push(...path.map((entry) => entry.blockId));
      path.push({ level, blockId: block.blockId });
      headingPath.set(first.moduleId, path);
    } else {
      block.contextBlockIds.push(...path.map((entry) => entry.blockId));
    }
    // Explicit ancestors carry lead text and enclosing procedural conditions.
    let parentId = first.parentUnitId;
    while (parentId) {
      const parent = byId.get(parentId);
      if (!parent) throw new Error('TRANSLATION_PLAN_PARENT_MISSING');
      const parentBlock = assigned.get(parentId)!;
      if (parentBlock !== block.blockId)
        block.contextBlockIds.push(parentBlock);
      parentId = parent.parentUnitId;
    }
    // Source-bound semantic projection supplies real ancestor content, not rewritten model context.
    for (const unitId of block.sourceUnitIds) {
      const unit = byId.get(unitId)!;
      if (unit.mapping.semanticContextUnitIds === undefined) continue;
      for (const contextId of stringArray(unit.mapping.semanticContextUnitIds, 'mapping.semanticContextUnitIds')) {
        const contextBlock = assigned.get(contextId);
        if (!contextBlock) throw new Error('TRANSLATION_PLAN_SEMANTIC_CONTEXT_MISSING');
        if (contextBlock !== block.blockId) block.contextBlockIds.push(contextBlock);
      }
    }
    block.contextBlockIds = [...new Set(block.contextBlockIds)];
  }
  const scopedConditions: TranslationSourcePlanV2['documentContext']['scopedConditions'] =
    [];
  for (const unit of units.filter((entry) => entry.kind === 'advisory')) {
    const advisoryBlockId = assigned.get(unit.unitId)!;
    const scope = recordValue(unit.payload.scope, 'advisory.scope');
    const targets = advisoryTargets(unit, scope, units, byId);
    const targetBlockIds = [
      ...new Set(targets.map((target) => assigned.get(target.unitId)!)),
    ].filter((id) => id !== advisoryBlockId);
    for (const id of targetBlockIds) {
      const target = byBlockId.get(id)!;
      target.contextBlockIds = [
        ...new Set([...target.contextBlockIds, advisoryBlockId]),
      ];
      target.requiredTogetherBlockIds.push(advisoryBlockId);
    }
    scopedConditions.push({
      advisoryBlockId,
      targetBlockIds,
      anchorIds: anchorsByUnit
        .get(unit.unitId)!
        .map((anchor) => anchor.anchorId),
    });
  }

  for (const block of blocks) {
    const group = block.sourceUnitIds.map((id) => byId.get(id)!);
    const sourceRefIds = new Set(group.flatMap((unit) => unit.sourceRefIds));
    const issue = (
      code: string,
      severity: TranslationIssueV2['severity'],
      message: string,
      sourceFindingId?: string,
    ): void => {
      block.sourceIssues.push({
        code,
        severity,
        origin: 'SOURCE',
        message,
        blockIds: [block.blockId],
        anchorIds: [...block.anchorIds],
        ...(sourceFindingId ? { sourceFindingId } : {}),
      });
    };
    for (const finding of input.source.findings) {
      const affectedUnits = stringArray(
        finding.affectedUnitIds,
        'finding.affectedUnitIds',
      );
      const affectedRefs = stringArray(
        finding.sourceRefIds,
        'finding.sourceRefIds',
      );
      if (
        affectedUnits.some((id) => block.sourceUnitIds.includes(id)) ||
        affectedRefs.some((id) => sourceRefIds.has(id)) ||
        (affectedUnits.length === 0 && affectedRefs.length === 0)
      ) {
        issue(
          String(finding.code),
          finding.blocking === true
            ? 'BLOCK'
            : finding.severity === 'info'
              ? 'NOTE'
              : 'REVIEW',
          String(finding.message),
          String(finding.findingId),
        );
      }
    }
    if (group.some((unit) => unit.kind === 'figure')) {
      issue(
        'FIGURE_TEXT_COVERAGE_UNVERIFIED',
        'BLOCK',
        '图示标题不代表图内文字已经提取；需要核对该图示的文字范围。',
      );
    }
    if (
      group.some(
        (unit) =>
          unit.kind === 'preserved_source' ||
          (unit.kind === 'table' && unit.payload.layout === 'preserved'),
      )
    ) {
      issue(
        'SOURCE_STRUCTURE_PRESERVED_AS_TEXT',
        'REVIEW',
        '源内容仅保留为文本；无法据此确认表格或版式关系。',
      );
    }
    if (
      group.some(
        (unit) =>
          unit.mapping.confidence === 'low' ||
          unit.mapping.confidence === 'needs_review',
      )
    ) {
      issue(
        'SOURCE_MAPPING_REQUIRES_REVIEW',
        'REVIEW',
        '解析包标记此处来源映射仍需核对。',
      );
    }
    if (
      block.anchorIds.length === 0 &&
      block.kind !== 'reference' &&
      block.kind !== 'list'
    ) {
      issue(
        'SOURCE_TEXT_UNAVAILABLE',
        'BLOCK',
        '此范围没有可供翻译的源文字，不能用占位内容记为已译。',
      );
    }
  }

  return {
    schemaVersion: 'wiselink.3_1.translation_source_plan.v2',
    planRevision: input.planRevision ?? 1,
    source: {
      documentVersionId: input.documentVersionId,
      packageId: input.packageId,
      parsedArtifact: structuredClone(input.parsedArtifact),
    },
    anchors,
    blocks,
    inventory: units.map((unit) => {
      const unitAnchors = anchorsByUnit.get(unit.unitId)!;
      const block = byBlockId.get(assigned.get(unit.unitId)!)!;
      return {
        sourceUnitId: unit.unitId,
        blockId: block.blockId,
        anchorIds: unitAnchors.map((anchor) => anchor.anchorId),
        sourceCharacterCount: unitAnchors.reduce(
          (total, anchor) => total + [...anchor.sourceText].length,
          0,
        ),
        textAvailability: block.sourceIssues.some(
          (issue) => issue.severity === 'BLOCK',
        )
          ? 'SOURCE_REVIEW_REQUIRED'
          : unitAnchors.length
            ? 'TEXT_AVAILABLE'
            : 'STRUCTURE_ONLY',
      };
    }),
    documentContext: {
      revision: 1,
      title: input.title,
      outline,
      scopedConditions,
      references: structuredClone(input.source.references),
      conditionAnchorIds: anchors
        .filter((anchor) =>
          /\b(?:unless|except|only if|provided that|shall not|must not|do not|not applicable)\b/iu.test(
            anchor.sourceText,
          ),
        )
        .map((anchor) => anchor.anchorId),
      definitionAnchorIds: anchors
        .filter((anchor) =>
          /\b(?:means|defined as|refers to|abbreviations?|definitions?)\b/iu.test(
            anchor.sourceText,
          ),
        )
        .map((anchor) => anchor.anchorId),
    },
  };
}

function readingOrder(
  source: TranslationStructuredSource,
): TranslationStructuredSourceUnit[] {
  const byId = new Map(source.units.map((unit) => [unit.unitId, unit]));
  if (byId.size !== source.units.length)
    throw new Error('TRANSLATION_PLAN_DUPLICATE_SOURCE_UNIT');
  const ordered: TranslationStructuredSourceUnit[] = [];
  const visit = (
    moduleId: string,
    parentUnitId: string | null,
    parents: Set<string>,
  ): void => {
    const siblings = source.units
      .filter(
        (unit) =>
          unit.moduleId === moduleId && unit.parentUnitId === parentUnitId,
      )
      .sort((a, b) => a.order - b.order);
    for (const unit of siblings) {
      if (parents.has(unit.unitId))
        throw new Error('TRANSLATION_PLAN_PARENT_CYCLE');
      ordered.push(unit);
      visit(moduleId, unit.unitId, new Set([...parents, unit.unitId]));
    }
  };
  for (const module of [...source.modules].sort((a, b) => a.order - b.order))
    visit(module.moduleId, null, new Set());
  if (
    ordered.length !== source.units.length ||
    new Set(ordered.map((unit) => unit.unitId)).size !== source.units.length
  ) {
    throw new Error('TRANSLATION_PLAN_SOURCE_INVENTORY_INCOMPLETE');
  }
  return ordered;
}

interface SourceTextField {
  path: string;
  text: string;
  sourceRefIds: string[];
}

function sourceTextFields(
  unit: TranslationStructuredSourceUnit,
): SourceTextField[] {
  const fields: SourceTextField[] = [];
  const add = (
    record: Record<string, unknown>,
    name: string,
    path: string,
    refs = unit.sourceRefIds,
  ): void => {
    const text = record[name];
    if (typeof text === 'string' && text.trim() !== '')
      fields.push({ path: `${path}/${name}`, text, sourceRefIds: refs });
  };
  const payload = unit.payload;
  for (const name of [
    'text',
    'instructionText',
    'title',
    'label',
    'marker',
    'caption',
    'rawText',
  ])
    add(payload, name, '/payload');
  if (unit.kind === 'table' && payload.layout === 'grid') {
    if (payload.columns !== undefined)
      recordArray(payload.columns, 'table.columns').forEach((value, index) => {
        const column = recordValue(value, 'table.column');
        add(
          column,
          'name',
          `/payload/columns/${index}`,
          stringArray(column.sourceRefIds, 'column.sourceRefIds'),
        );
      });
    recordArray(payload.rowGroups, 'table.rowGroups').forEach(
      (groupValue, groupIndex) => {
        const group = recordValue(groupValue, 'table.rowGroup');
        recordArray(group.rows, 'table.rows').forEach((rowValue, rowIndex) => {
          const row = recordValue(rowValue, 'table.row');
          recordArray(row.cells, 'table.cells').forEach(
            (cellValue, cellIndex) => {
              const cell = recordValue(cellValue, 'table.cell');
              recordArray(cell.inlineContent, 'table.inlineContent').forEach(
                (inlineValue, inlineIndex) => {
                  const inline = recordValue(inlineValue, 'table.inline');
                  add(
                    inline,
                    'text',
                    `/payload/rowGroups/${groupIndex}/rows/${rowIndex}/cells/${cellIndex}/inlineContent/${inlineIndex}`,
                    stringArray(inline.sourceRefIds, 'inline.sourceRefIds'),
                  );
                },
              );
            },
          );
        });
      },
    );
  }
  return fields;
}

function blockKind(kind: string): TranslationSemanticBlockV2['kind'] {
  if (kind === 'paragraph' || kind === 'list_item') return 'prose';
  if (
    kind === 'heading' ||
    kind === 'list' ||
    kind === 'step' ||
    kind === 'advisory' ||
    kind === 'table' ||
    kind === 'figure' ||
    kind === 'reference' ||
    kind === 'preserved_source'
  )
    return kind;
  throw new Error('TRANSLATION_PLAN_SOURCE_KIND_UNSUPPORTED');
}

function tableContinuation(
  unit: TranslationStructuredSourceUnit,
): string | null {
  if (unit.payload.layout !== 'grid' || unit.payload.continuation === undefined)
    return null;
  const continuation = recordValue(
    unit.payload.continuation,
    'table.continuation',
  );
  return typeof continuation.continuityKey === 'string'
    ? continuation.continuityKey
    : null;
}

function compatibleTableContinuation(
  left: TranslationStructuredSourceUnit,
  right: TranslationStructuredSourceUnit,
): boolean {
  if (
    tableContinuation(left) !== tableContinuation(right) ||
    left.payload.columnCount !== right.payload.columnCount
  )
    return false;
  const columns = (unit: TranslationStructuredSourceUnit) =>
    unit.payload.columns === undefined
      ? null
      : recordArray(unit.payload.columns, 'table.columns').map((value) => {
          const column = recordValue(value, 'table.column');
          return {
            order: column.order,
            name: column.name,
            align: column.align,
            width: column.width,
          };
        });
  return canonicalJson(columns(left)) === canonicalJson(columns(right));
}

function advisoryTargets(
  advisory: TranslationStructuredSourceUnit,
  scope: Record<string, unknown>,
  units: TranslationStructuredSourceUnit[],
  byId: Map<string, TranslationStructuredSourceUnit>,
): TranslationStructuredSourceUnit[] {
  const explicit = stringArray(scope.targetUnitIds, 'advisory.targetUnitIds');
  if (scope.kind === 'module')
    return units.filter((unit) => unit.moduleId === advisory.moduleId);
  if (scope.kind === 'explicit_units')
    return explicit.map((id) => {
      const unit = byId.get(id);
      if (!unit) throw new Error('TRANSLATION_PLAN_ADVISORY_TARGET_MISSING');
      return unit;
    });
  const parent = advisory.parentUnitId
    ? byId.get(advisory.parentUnitId)
    : undefined;
  if (!parent) throw new Error('TRANSLATION_PLAN_ADVISORY_PARENT_MISSING');
  if (scope.kind === 'parent_unit') return [parent];
  if (scope.kind !== 'parent_subtree')
    throw new Error('TRANSLATION_PLAN_ADVISORY_SCOPE_INVALID');
  return units.filter((unit) => {
    let current: TranslationStructuredSourceUnit | undefined = unit;
    while (current) {
      if (current.unitId === parent.unitId) return true;
      current = current.parentUnitId
        ? byId.get(current.parentUnitId)
        : undefined;
    }
    return false;
  });
}

function finiteInteger(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value))
    throw new Error(`TRANSLATION_PLAN_INVALID:${field}`);
  return value;
}
