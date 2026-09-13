import type { DocumentOriginalResult } from '../../../../../../shared/document-original.interface';
import type { TranslationStructuredSource } from '../../../../../../shared/canonical-translation-v2.interface';
import type {
  DocumentSemanticMap,
  DocumentSemanticProfile,
  DocumentSemanticSection,
  DocumentSemanticSelection,
} from '../../../../../../shared/document-semantic-map.interface';

function label(text: string): string {
  return text
    .normalize('NFKC')
    .trim()
    .replace(/^(?:\d+(?:\.\d+)*[.)]?|[A-Z][.)])\s+/, '')
    .replace(/\s+/g, ' ')
    .replace(/[:：]\s*$/, '')
    .toLowerCase();
}

function sameBinding(
  map: DocumentSemanticMap,
  original: DocumentOriginalResult,
): boolean {
  return (
    Object.keys(original.binding) as Array<keyof typeof original.binding>
  ).every((key) => original.binding[key] === map.binding[key]);
}

/** Uses author heading levels for boundaries. Profile roles never create missing author sections. */
export function buildDocumentSemanticMap(input: {
  original: DocumentOriginalResult;
  semanticRevision: number;
  profile: DocumentSemanticProfile;
}): DocumentSemanticMap {
  const { original, profile } = input;
  const aliases = new Map<string, DocumentSemanticProfile['roles'][number]>();
  for (const rule of profile.roles)
    for (const alias of rule.aliases) {
      const key = label(alias);
      if (
        !key ||
        (aliases.has(key) && aliases.get(key)?.roleKey !== rule.roleKey)
      )
        throw new Error('SEMANTIC_PROFILE_AMBIGUOUS');
      if (
        rule.headingLevel !== undefined &&
        (!Number.isSafeInteger(rule.headingLevel) || rule.headingLevel < 1)
      )
        throw new Error('SEMANTIC_PROFILE_LEVEL_INVALID');
      aliases.set(key, rule);
    }
  const sections: DocumentSemanticSection[] = [];
  const stack: Array<{ level: number; section: DocumentSemanticSection }> = [];
  // Keep author ancestry separately: a profile's peer level is local to its enclosing issue,
  // not an instruction to pop an author-supplied issue heading at that same numeric level.
  const authorStack: Array<{
    rawLevel: number;
    level: number;
    isRole: boolean;
  }> = [];
  const unassignedUnitIds: string[] = [];
  const occurrences = new Map<string, number>();
  const ordered = [...original.source.units].sort((a, b) => a.order - b.order);
  for (const unit of ordered) {
    if (unit.kind !== 'heading') {
      const current = stack.at(-1)?.section;
      (current ? current.bodyUnitIds : unassignedUnitIds).push(unit.unitId);
      continue;
    }
    const titleRaw =
      typeof unit.payload.text === 'string' ? unit.payload.text : '';
    const value = unit.payload.level;
    const rule = aliases.get(label(titleRaw));
    const rawLevel =
      typeof value === 'number' && Number.isInteger(value) && value > 0
        ? value
        : 1;
    while (
      authorStack.length &&
      authorStack[authorStack.length - 1].rawLevel >= rawLevel
    )
      authorStack.pop();
    // Only author ancestors above the first recognized role define the issue scope.
    // A styled statement inside Applicability/Interim Action cannot create a new issue scope.
    const firstRole = authorStack.findIndex((entry) => entry.isRole);
    const enclosing = (
      firstRole < 0 ? authorStack : authorStack.slice(0, firstRole)
    ).at(-1);
    const level =
      rule?.headingLevel === undefined
        ? rawLevel
        : Math.max(rule.headingLevel, (enclosing?.level ?? 0) + 1);
    while (stack.length && stack[stack.length - 1].level >= level) stack.pop();
    const parentSectionId = stack.at(-1)?.section.sectionId ?? null;
    const roleKey = rule?.roleKey ?? null;
    const occurrenceKey = JSON.stringify([parentSectionId, label(titleRaw)]);
    const occurrence = (occurrences.get(occurrenceKey) ?? 0) + 1;
    occurrences.set(occurrenceKey, occurrence);
    const section: DocumentSemanticSection = {
      sectionId: `section:${unit.unitId}`,
      headingUnitId: unit.unitId,
      parentSectionId,
      titleRaw,
      roleKey,
      occurrence,
      bodyUnitIds: [],
      sourceRefIds: [],
      contentState: 'EMPTY',
      emptyLiteral: null,
      mappingSource: roleKey ? 'PROFILE_RULE' : 'AUTHOR_HEADING',
    };
    sections.push(section);
    stack.push({ level, section });
    authorStack.push({ rawLevel, level, isRole: Boolean(rule) });
  }
  const byId = new Map(ordered.map((unit) => [unit.unitId, unit]));
  for (const section of sections) {
    const body = section.bodyUnitIds.map((id) => byId.get(id)!);
    const members = [byId.get(section.headingUnitId)!, ...body];
    section.sourceRefIds = [
      ...new Set(members.flatMap((unit) => unit.sourceRefIds)),
    ];
    const literal =
      body.length === 1 &&
      body[0].kind === 'paragraph' &&
      typeof body[0].payload.text === 'string'
        ? body[0].payload.text.trim()
        : null;
    // Keep exact None versus N/A. A table, multiple statements or a missing chapter is not an empty assertion.
    const normalized = literal?.toLowerCase().replace(/[.。]$/, '');
    const hasChildren = sections.some(
      (child) => child.parentSectionId === section.sectionId,
    );
    section.contentState =
      normalized === 'none' && !hasChildren
        ? 'EXPLICIT_NONE'
        : ['n/a', 'not applicable'].includes(normalized ?? '') && !hasChildren
          ? 'EXPLICIT_NA'
          : body.length || hasChildren
            ? 'CONTENT'
            : 'EMPTY';
    section.emptyLiteral = section.contentState.startsWith('EXPLICIT_')
      ? literal
      : null;
    if (
      original.coverage.unresolvedRanges.some(
        (range) =>
          range.reason === 'UNREAD' &&
          range.unitIds.some(
            (id) =>
              id === section.headingUnitId || section.bodyUnitIds.includes(id),
          ),
      )
    ) {
      section.contentState = 'UNREAD';
      section.emptyLiteral = null;
    }
  }
  const result: DocumentSemanticMap = {
    schemaVersion: 'wiselink.document.semantic-map.v1',
    binding: { ...original.binding },
    semanticRevision: input.semanticRevision,
    profileRef: profile.profileRef,
    sections,
    unassignedUnitIds,
    organizationWarnings: organizationWarnings(sections),
    unresolvedRanges: structuredClone(original.coverage.unresolvedRanges),
  };
  assertDocumentSemanticMap(result, original);
  return result;
}

function organizationWarnings(
  sections: DocumentSemanticSection[],
): DocumentSemanticMap['organizationWarnings'] {
  return sections.flatMap((section, index) => {
    const next = sections[index + 1];
    return section.roleKey &&
      section.contentState === 'EMPTY' &&
      next &&
      !next.roleKey &&
      next.parentSectionId === section.parentSectionId
      ? [
          {
            code: 'EMPTY_ROLE_FOLLOWED_BY_UNCLASSIFIED_HEADING' as const,
            sectionIds: [section.sectionId, next.sectionId],
            unitIds: [section.headingUnitId, next.headingUnitId],
          },
        ]
      : [];
  });
}

/** Run after readback as well as before save. Host still performs actor/tenant authorization and CAS. */
export function assertDocumentSemanticMap(
  map: DocumentSemanticMap,
  original: DocumentOriginalResult,
): void {
  if (
    map.schemaVersion !== 'wiselink.document.semantic-map.v1' ||
    !sameBinding(map, original) ||
    !Number.isSafeInteger(map.semanticRevision) ||
    map.semanticRevision < 1 ||
    !map.profileRef.trim()
  ) {
    throw new Error('SEMANTIC_BINDING_INVALID');
  }
  const units = new Map(
    original.source.units.map((unit) => [unit.unitId, unit]),
  );
  const sections = new Map(
    map.sections.map((section) => [section.sectionId, section]),
  );
  if (
    sections.size !== map.sections.length ||
    units.size !== original.source.units.length
  )
    throw new Error('SEMANTIC_DUPLICATE_ID');
  const claimed = new Set<string>();
  const claim = (id: string) => {
    if (!units.has(id) || claimed.has(id))
      throw new Error('SEMANTIC_MEMBER_INVALID');
    claimed.add(id);
  };
  for (const id of map.unassignedUnitIds) claim(id);
  for (const section of map.sections) {
    const heading = units.get(section.headingUnitId);
    if (
      !section.sectionId ||
      heading?.kind !== 'heading' ||
      heading.payload.text !== section.titleRaw ||
      !Number.isSafeInteger(section.occurrence) ||
      section.occurrence < 1
    )
      throw new Error('SEMANTIC_HEADING_INVALID');
    if (
      !['CONTENT', 'EXPLICIT_NONE', 'EXPLICIT_NA', 'EMPTY', 'UNREAD'].includes(
        section.contentState,
      ) ||
      !['AUTHOR_HEADING', 'PROFILE_RULE'].includes(section.mappingSource) ||
      (section.roleKey !== null &&
        (typeof section.roleKey !== 'string' || !section.roleKey.trim()))
    )
      throw new Error('SEMANTIC_STATE_INVALID');
    if (section.contentState.startsWith('EXPLICIT_')) {
      const body = units.get(section.bodyUnitIds[0]);
      const literal =
        typeof body?.payload.text === 'string'
          ? body.payload.text.trim()
          : null;
      const normalized = literal?.toLowerCase().replace(/[.。]$/, '');
      if (
        section.bodyUnitIds.length !== 1 ||
        body?.kind !== 'paragraph' ||
        literal !== section.emptyLiteral ||
        (section.contentState === 'EXPLICIT_NONE'
          ? normalized !== 'none'
          : !['n/a', 'not applicable'].includes(normalized ?? '')) ||
        map.sections.some(
          (child) => child.parentSectionId === section.sectionId,
        )
      )
        throw new Error('SEMANTIC_EMPTY_ASSERTION_INVALID');
    } else if (section.emptyLiteral !== null)
      throw new Error('SEMANTIC_EMPTY_ASSERTION_INVALID');
    claim(section.headingUnitId);
    for (const id of section.bodyUnitIds) claim(id);
    const expected = [
      ...new Set(
        [section.headingUnitId, ...section.bodyUnitIds].flatMap(
          (id) => units.get(id)!.sourceRefIds,
        ),
      ),
    ].sort();
    if (
      JSON.stringify(expected) !==
      JSON.stringify([...section.sourceRefIds].sort())
    )
      throw new Error('SEMANTIC_SOURCE_REFS_INVALID');
    const visited = new Set([section.sectionId]);
    let parent = section.parentSectionId;
    while (parent !== null) {
      if (!sections.has(parent) || visited.has(parent))
        throw new Error('SEMANTIC_PARENT_INVALID');
      visited.add(parent);
      parent = sections.get(parent)!.parentSectionId;
    }
  }
  if (
    JSON.stringify(map.organizationWarnings) !==
    JSON.stringify(organizationWarnings(map.sections))
  )
    throw new Error('SEMANTIC_WARNINGS_CHANGED');
  if (claimed.size !== units.size)
    throw new Error('SEMANTIC_COVERAGE_INCOMPLETE');
  if (
    JSON.stringify(map.unresolvedRanges) !==
    JSON.stringify(original.coverage.unresolvedRanges)
  )
    throw new Error('SEMANTIC_COVERAGE_CHANGED');
}

/** Exact selector; no latest fallback. Returns original IDs, including parent context, not synthesized prose. */
export function selectDocumentSemanticSection(
  original: DocumentOriginalResult,
  map: DocumentSemanticMap,
  sectionId: string,
): DocumentSemanticSelection {
  assertDocumentSemanticMap(map, original);
  const sections = new Map(
    map.sections.map((section) => [section.sectionId, section]),
  );
  const target = sections.get(sectionId);
  if (!target) throw new Error('SEMANTIC_SECTION_NOT_FOUND');
  const ancestors: DocumentSemanticSection[] = [];
  let parent = target.parentSectionId;
  while (parent) {
    const entry = sections.get(parent)!;
    ancestors.unshift(entry);
    parent = entry.parentSectionId;
  }
  const members = new Set<string>();
  const visit = (entry: DocumentSemanticSection) => {
    members.add(entry.headingUnitId);
    entry.bodyUnitIds.forEach((id) => members.add(id));
    for (const child of map.sections)
      if (child.parentSectionId === entry.sectionId) visit(child);
  };
  visit(target);
  const context = new Set(
    ancestors.flatMap((entry) => [entry.headingUnitId, ...entry.bodyUnitIds]),
  );
  // When heading formatting may have split the real body away, expose that adjacent range as uncertain context.
  // This helps the reader/model inspect it without asserting a false parent relationship.
  const relevantSections = new Set([
    sectionId,
    ...ancestors.map((entry) => entry.sectionId),
  ]);
  for (const warning of map.organizationWarnings) {
    if (!relevantSections.has(warning.sectionIds[0])) continue;
    const ambiguous = sections.get(warning.sectionIds[1])!;
    context.add(ambiguous.headingUnitId);
    ambiguous.bodyUnitIds.forEach((id) => context.add(id));
  }
  const ordered = [...original.source.units].sort((a, b) => a.order - b.order);
  return {
    binding: { ...map.binding },
    semanticRevision: map.semanticRevision,
    profileRef: map.profileRef,
    sectionId,
    ancestorSectionIds: ancestors.map((entry) => entry.sectionId),
    organizationWarnings: structuredClone(map.organizationWarnings),
    contextUnitIds: ordered
      .filter((unit) => context.has(unit.unitId))
      .map((unit) => unit.unitId),
    unitIds: ordered
      .filter((unit) => members.has(unit.unitId))
      .map((unit) => unit.unitId),
    sourceRefIds: [
      ...new Set(
        ordered
          .filter(
            (unit) => context.has(unit.unitId) || members.has(unit.unitId),
          )
          .flatMap((unit) => unit.sourceRefIds),
      ),
    ],
    // Preserve document-wide unknowns too: a role/section selector does not certify omitted pages or figures.
    unresolvedRanges: structuredClone(map.unresolvedRanges),
  };
}

/** Transient V2 view; never overwrite the immutable original bundle with this organization. */
export function semanticTranslationSource(
  original: DocumentOriginalResult,
  map: DocumentSemanticMap,
): TranslationStructuredSource {
  assertDocumentSemanticMap(map, original);
  const result = structuredClone(original.source);
  const byId = new Map(result.units.map((unit) => [unit.unitId, unit]));
  const sections = new Map(
    map.sections.map((section) => [section.sectionId, section]),
  );
  const depth = (section: DocumentSemanticSection): number =>
    section.parentSectionId
      ? 1 + depth(sections.get(section.parentSectionId)!)
      : 0;
  // Preserve module boundaries; unsupported relationships must be surfaced, not silently dropped by the V2 planner.
  for (const section of map.sections) {
    const heading = byId.get(section.headingUnitId)!;
    const parentHeading = section.parentSectionId
      ? byId.get(sections.get(section.parentSectionId)!.headingUnitId)!
      : null;
    if (parentHeading && parentHeading.moduleId !== heading.moduleId)
      throw new Error('SEMANTIC_CROSS_MODULE_PARENT');
    const contextUnitIds: string[] = [];
    let ancestor = parentHeading
      ? sections.get(section.parentSectionId!)
      : undefined;
    while (ancestor) {
      contextUnitIds.unshift(ancestor.headingUnitId, ...ancestor.bodyUnitIds);
      ancestor = ancestor.parentSectionId
        ? sections.get(ancestor.parentSectionId)
        : undefined;
    }
    heading.mapping = {
      ...heading.mapping,
      semanticContextUnitIds: contextUnitIds,
    };
    heading.parentUnitId = parentHeading?.unitId ?? null;
    heading.depth = depth(section);
    heading.payload = { ...heading.payload, level: heading.depth + 1 };
    for (const id of section.bodyUnitIds) {
      const unit = byId.get(id)!;
      if (unit.moduleId !== heading.moduleId)
        throw new Error('SEMANTIC_CROSS_MODULE_PARENT');
      unit.mapping = {
        ...unit.mapping,
        semanticContextUnitIds: [...contextUnitIds, heading.unitId],
      };
      unit.parentUnitId = heading.unitId;
      unit.depth = heading.depth + 1;
      unit.continuityKey = section.sectionId;
    }
  }
  return result;
}

/** Same-original mapping correction: compare relationships, not generated section IDs or revision counters. */
export function compareDocumentSemanticMaps(
  original: DocumentOriginalResult,
  previous: DocumentSemanticMap,
  next: DocumentSemanticMap,
): {
  changed: boolean;
  affectedUnitIds: string[];
} {
  assertDocumentSemanticMap(previous, original);
  assertDocumentSemanticMap(next, original);
  const dependencies = (map: DocumentSemanticMap) => {
    const sections = new Map(
      map.sections.map((section) => [section.sectionId, section]),
    );
    const result = new Map<string, string>();
    for (const section of map.sections) {
      const path: unknown[] = [];
      let current: DocumentSemanticSection | undefined = section;
      while (current) {
        // Parent direct members carry conditions too. Moving an exception out of the parent affects all descendants.
        path.unshift([
          current.headingUnitId,
          current.roleKey,
          current.bodyUnitIds,
          current.contentState,
        ]);
        current = current.parentSectionId
          ? sections.get(current.parentSectionId)
          : undefined;
      }
      for (const id of [section.headingUnitId, ...section.bodyUnitIds])
        result.set(id, JSON.stringify(path));
    }
    return result;
  };
  const before = dependencies(previous);
  const after = dependencies(next);
  const affectedUnitIds = original.source.units
    .filter((unit) => before.get(unit.unitId) !== after.get(unit.unitId))
    .map((unit) => unit.unitId);
  return { changed: affectedUnitIds.length > 0, affectedUnitIds };
}
