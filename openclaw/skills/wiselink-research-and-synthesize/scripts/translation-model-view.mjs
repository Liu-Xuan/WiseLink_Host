import {
  buildNaturalTranslationProjection, renderNaturalSourceDocument,
} from './translation-natural-projection.mjs';

/** Host IDs and source bindings stay private; the model sees one readable
 * document plus exact local aliases for target anchors and candidates. */
export function buildTranslationModelView(batch) {
  if (batch.purpose === 'GENERATE') return buildNaturalTranslationProjection(batch);
  const blockAliases = new Map(); const anchorAliases = new Map(); const unitAliases = new Map();
  const alias = (map, prefix, value) => {
    if (typeof value !== 'string' || !value) throw new Error('TRANSLATION_MODEL_REFERENCE_INVALID');
    if (!map.has(value)) map.set(value, `${prefix}${map.size + 1}`);
    return map.get(value);
  };
  const blockId = (value) => alias(blockAliases, 'B', value);
  const anchorId = (value) => alias(anchorAliases, 'A', value);
  const unitId = (value) => alias(unitAliases, 'U', value);
  const context = batch.documentContext;
  const allBlocks = [...batch.blocks, ...(context.blocks ?? [])];
  const allAnchors = [...batch.anchors, ...(context.anchors ?? [])];
  if (new Set(allAnchors.map((entry) => entry.anchorId)).size !== allAnchors.length)
    throw new Error('TRANSLATION_MODEL_ANCHOR_DUPLICATE');
  for (const block of allBlocks) blockId(block.blockId);
  for (const anchor of allAnchors) anchorId(anchor.anchorId);
  const issue = (value) => ({
    code: value.code, severity: value.severity, origin: value.origin, message: value.message,
    ...(value.blockIds ? { blockIds: value.blockIds.map(blockId) } : {}),
    anchorIds: value.anchorIds.map(anchorId),
  });
  const layout = (value) => {
    if (Array.isArray(value)) return value.map(layout);
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(Object.entries(value).filter(([key]) => !['sourceRefId', 'sourceRefIds', 'sourceSegmentIds'].includes(key)).map(([key, item]) => [key,
      typeof item === 'string' && /(?:^unitId$|UnitId$)/u.test(key) ? unitId(item)
        : Array.isArray(item) && /UnitIds$/u.test(key) ? item.map(unitId) : layout(item)]));
  };
  const assigned = allBlocks.flatMap((entry) => entry.anchorIds);
  if (assigned.length !== allAnchors.length || new Set(assigned).size !== assigned.length)
    throw new Error('TRANSLATION_NATURAL_SOURCE_INVALID');
  const sourceCoverage = batch.sourcePlanAnchorCount === allAnchors.length &&
    batch.sourcePlanBlockCount === allBlocks.length ? 'FULL' : 'PARTIAL_REGISTERED';
  const renderedIds = [];
  const { document, sections } = renderNaturalSourceDocument(
    allBlocks, allAnchors, (id) => {
      renderedIds.push(id);
      return `⟦WL-ANCHOR:${anchorId(id)}⟧ `;
    },
  );
  if (renderedIds.length !== allAnchors.length ||
      new Set(renderedIds).size !== allAnchors.length)
    throw new Error('TRANSLATION_MODEL_SOURCE_COVERAGE_INVALID');
  const block = (value) => ({
    blockId: blockId(value.blockId), section: sections.get(value.blockId),
    kind: value.kind, anchorIds: value.anchorIds.map(anchorId),
  });
  const sectionMap = [...allBlocks].sort((a, b) => a.order - b.order)
    .map((value) => ({ blockId: blockId(value.blockId),
      section: sections.get(value.blockId), anchorIds: value.anchorIds.map(anchorId) }));
  const anchorsByUnit = new Map();
  for (const anchor of allAnchors) {
    const entries = anchorsByUnit.get(anchor.sourceUnitId) ?? [];
    entries.push(anchor);
    anchorsByUnit.set(anchor.sourceUnitId, entries);
  }
  // Source text is emitted only in document. Check each pointer against the
  // actual payload, then retain only structure that the natural rendering did
  // not express (for example warning level or table continuation metadata).
  const metadata = [];
  for (const value of allBlocks) {
    const units = [];
    for (const unit of value.sourceStructure ?? []) {
      const payload = structuredClone(unit.payload);
      for (const anchor of anchorsByUnit.get(unit.sourceUnitId) ?? []) {
        if (!anchor.payloadPath) continue;
        const path = anchor.payloadPath.split('/').slice(1)
          .map((part) => part.replaceAll('~1', '/').replaceAll('~0', '~'));
        let parent = { payload };
        for (const key of path.slice(0, -1)) {
          if (!parent || typeof parent !== 'object' || !Object.hasOwn(parent, key))
            throw new Error('TRANSLATION_MODEL_LAYOUT_BINDING_INVALID');
          parent = parent[key];
        }
        const key = path.at(-1);
        if (!key || !parent || typeof parent !== 'object' || !Object.hasOwn(parent, key) ||
            parent[key] !== anchor.sourceText)
          throw new Error('TRANSLATION_MODEL_LAYOUT_BINDING_INVALID');
        delete parent[key];
      }
      const prune = (item, path = '') => {
        if (Array.isArray(item)) {
          const children = item.map((child, index) => prune(child, `${path}/${index}`));
          return children.every((child) => child === undefined) ? undefined
            : children.map((child) => child ?? null);
        }
        if (!item || typeof item !== 'object') return item;
        const fields = Object.entries(item).flatMap(([key, child]) => {
          if (['sourceRefId', 'sourceRefIds', 'sourceSegmentIds'].includes(key)) return [];
          // These fields are already represented by the rendered table.
          if (unit.kind === 'table' && (
            (path === '' && key === 'layout') ||
            (/\/cells\/\d+$/u.test(path) && ['rowSpan', 'colSpan', 'isHeader'].includes(key)) ||
            (/\/rowGroups\/\d+$/u.test(path) && key === 'kind')
          )) return [];
          const next = prune(child, `${path}/${key}`);
          return next === undefined ? [] : [[key, next]];
        });
        return fields.length ? Object.fromEntries(fields) : undefined;
      };
      const residual = prune(payload);
      if (residual !== undefined)
        units.push({ sourceUnitId: unitId(unit.sourceUnitId), kind: unit.kind,
          payload: layout(residual) });
    }
    if (units.length || (value.contextBlockIds ?? []).length ||
        (value.requiredTogetherBlockIds ?? []).length || (value.sourceIssues ?? []).length)
      metadata.push({ blockId: blockId(value.blockId),
        ...(units.length ? { units } : {}),
        ...((value.contextBlockIds ?? []).length ? { contextBlockIds: value.contextBlockIds.map(blockId) } : {}),
        ...((value.requiredTogetherBlockIds ?? []).length ? { requiredTogetherBlockIds: value.requiredTogetherBlockIds.map(blockId) } : {}),
        ...((value.sourceIssues ?? []).length ? { sourceIssues: value.sourceIssues.map(issue) } : {}),
      });
  }
  const targetAnchor = (value) => ({ anchorId: anchorId(value.anchorId),
    ...(value.sourceUnitId ? { sourceUnitId: unitId(value.sourceUnitId) } : {}),
    ...(value.payloadPath ? { payloadPath: value.payloadPath } : {}) });
  const candidate = (value) => value ? { blockId: blockId(value.blockId),
    elements: value.elements.map((element) => ({ kind: element.kind, translatedText: element.translatedText, anchorIds: element.anchorIds.map(anchorId) })) } : null;
  const input = {
    schemaVersion: batch.schemaVersion, purpose: batch.purpose, sourceLocale: batch.sourceLocale, targetLocale: batch.targetLocale,
    sourceCoverage, document, blocks: batch.blocks.map(block), targetAnchors: batch.anchors.map(targetAnchor),
    documentContext: {
      title: context.title,
      outline: (context.outline ?? []).map((entry) => ({ blockId: blockId(entry.blockId), anchorIds: entry.anchorIds.map(anchorId), level: entry.level })),
      scopedConditions: (context.scopedConditions ?? []).map((entry) => ({ advisoryBlockId: blockId(entry.advisoryBlockId), targetBlockIds: entry.targetBlockIds.map(blockId), anchorIds: entry.anchorIds.map(anchorId) })),
      conditionAnchorIds: (context.conditionAnchorIds ?? []).map(anchorId),
      definitionAnchorIds: (context.definitionAnchorIds ?? []).map(anchorId),
      references: structuredClone(context.references ?? []),
      sectionMap,
      ...(metadata.length ? { metadata } : {}), conditionsAreSourceQuotations: true,
    },
    terminology: structuredClone(batch.terminology), previousCandidate: candidate(batch.previousCandidate),
    ...(batch.checkCandidates ? { previousCandidates: batch.checkCandidates.map((entry) => candidate(entry.candidate)) } : {}),
    correctionIssues: (batch.correctionIssues ?? []).map(issue),
  };
  const originalBlocks = new Map([...blockAliases].map(([original, short]) => [short, original]));
  const originalAnchors = new Map([...anchorAliases].map(([original, short]) => [short, original]));
  const sourceByAnchor = new Map(allAnchors.map((value) => [value.anchorId, value.sourceText]));
  const original = (map, value) => {
    if (!map.has(value)) throw new Error('TRANSLATION_OUTPUT_REFERENCE_INVALID');
    return map.get(value);
  };
  return { input, restoreOutput(output) {
    // Preserve every field for the strict output validator; aliases never hide
    // an extra model field or make an out-of-scope source acceptable.
    const review = (value) => ({ ...value, blockId: original(originalBlocks, value.blockId),
      issues: value.issues.map((entry) => ({ ...entry, anchorIds: entry.anchorIds.map((id) => original(originalAnchors, id)) })) });
    if (batch.purpose === 'CHECK') return review(output);
    if (batch.purpose === 'CHECK_BATCH') return { ...output, checks: output.checks.map(review) };
    return { ...output, blocks: output.blocks.map((entry) => ({ ...entry, blockId: original(originalBlocks, entry.blockId),
      elements: entry.elements.map((element) => {
        const restoredIds = element.anchorIds.map((id) => original(originalAnchors, id));
        for (const match of element.translatedText.matchAll(/⟦WL-ANCHOR:A\d+⟧/gu)) {
          if (!restoredIds.some((id) => sourceByAnchor.get(id)?.includes(match[0])))
            throw new Error('TRANSLATION_OUTPUT_MARKER_LEAK');
        }
        return { ...element, anchorIds: restoredIds };
      }) })) };
  } };
}
