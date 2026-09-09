/** Lossless model-facing aliases. Host IDs, source bindings and execution
 * dependencies stay in the caller; only readable source and layout enter the
 * short native session. This does not choose, summarize or truncate context. */
export function buildTranslationModelView(batch) {
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
  const block = (value) => ({
    blockId: blockId(value.blockId), kind: value.kind, anchorIds: value.anchorIds.map(anchorId),
    contextBlockIds: (value.contextBlockIds ?? []).map(blockId),
    requiredTogetherBlockIds: (value.requiredTogetherBlockIds ?? []).map(blockId),
    sourceIssues: (value.sourceIssues ?? []).map(issue),
    sourceStructure: (value.sourceStructure ?? []).map((unit) => {
      const payload = structuredClone(unit.payload);
      for (const anchor of allAnchors.filter((entry) => entry.sourceUnitId === unit.sourceUnitId)) {
        // The exact source text remains in anchors. Replace only its verified
        // duplicate at the actual JSON pointer, preserving the complete table,
        // list, warning, span, footnote and figure structure around it.
        const path = anchor.payloadPath.split('/').slice(1).map((part) => part.replaceAll('~1', '/').replaceAll('~0', '~'));
        let parent = { payload };
        for (const key of path.slice(0, -1)) {
          if (!parent || typeof parent !== 'object' || !Object.hasOwn(parent, key)) throw new Error('TRANSLATION_MODEL_LAYOUT_BINDING_INVALID');
          parent = parent[key];
        }
        const key = path.at(-1);
        if (!key || !parent || typeof parent !== 'object' || !Object.hasOwn(parent, key) || parent[key] !== anchor.sourceText)
          throw new Error('TRANSLATION_MODEL_LAYOUT_BINDING_INVALID');
        Object.defineProperty(parent, key, { value: { sourceAnchorId: anchorId(anchor.anchorId) }, enumerable: true, configurable: true, writable: true });
      }
      return { sourceUnitId: unitId(unit.sourceUnitId), kind: unit.kind, payload: layout(payload) };
    }),
  });
  const anchor = (value) => ({ anchorId: anchorId(value.anchorId),
    ...(value.sourceUnitId ? { sourceUnitId: unitId(value.sourceUnitId) } : {}),
    ...(value.payloadPath ? { payloadPath: value.payloadPath } : {}), sourceText: value.sourceText });
  const candidate = (value) => value ? { blockId: blockId(value.blockId),
    elements: value.elements.map((element) => ({ kind: element.kind, translatedText: element.translatedText, anchorIds: element.anchorIds.map(anchorId) })) } : null;
  const input = {
    schemaVersion: batch.schemaVersion, purpose: batch.purpose, sourceLocale: batch.sourceLocale, targetLocale: batch.targetLocale,
    blocks: batch.blocks.map(block), anchors: batch.anchors.map(anchor),
    documentContext: {
      title: context.title,
      outline: (context.outline ?? []).map((entry) => ({ blockId: blockId(entry.blockId), anchorIds: entry.anchorIds.map(anchorId), level: entry.level })),
      scopedConditions: (context.scopedConditions ?? []).map((entry) => ({ advisoryBlockId: blockId(entry.advisoryBlockId), targetBlockIds: entry.targetBlockIds.map(blockId), anchorIds: entry.anchorIds.map(anchorId) })),
      conditionAnchorIds: (context.conditionAnchorIds ?? []).map(anchorId),
      definitionAnchorIds: (context.definitionAnchorIds ?? []).map(anchorId),
      references: structuredClone(context.references ?? []),
      blocks: (context.blocks ?? []).map(block), anchors: (context.anchors ?? []).map(anchor), conditionsAreSourceQuotations: true,
    },
    terminology: structuredClone(batch.terminology), previousCandidate: candidate(batch.previousCandidate),
    ...(batch.checkCandidates ? { previousCandidates: batch.checkCandidates.map((entry) => candidate(entry.candidate)) } : {}),
    correctionIssues: (batch.correctionIssues ?? []).map(issue),
  };
  const originalBlocks = new Map([...blockAliases].map(([original, short]) => [short, original]));
  const originalAnchors = new Map([...anchorAliases].map(([original, short]) => [short, original]));
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
      elements: entry.elements.map((element) => ({ ...element, anchorIds: element.anchorIds.map((id) => original(originalAnchors, id)) })) })) };
  } };
}
