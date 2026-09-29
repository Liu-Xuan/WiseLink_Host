const MARKER = /<!-- WL-SECTION:(\d+) -->/gu;

// The installed Skill is standalone; accept only the small HTML subset that
// this projection emits, without depending on the Host's node_modules.
function parseFragment(html) {
  const root = { tagName: null, childNodes: [] };
  const stack = [root];
  const tokens = html.match(/<[^>]*>|[^<]+/gu) ?? [];
  if (tokens.join('') !== html) throw new Error('TRANSLATION_NATURAL_HTML_INVALID');
  for (const token of tokens) {
    if (!token.startsWith('<')) {
      stack.at(-1).childNodes.push({ nodeName: '#text', value: decodeHtml(token) });
      continue;
    }
    const closing = /^<\/([a-z]+)>$/u.exec(token);
    if (closing) {
      if (stack.length === 1 || stack.at(-1).tagName !== closing[1])
        throw new Error('TRANSLATION_NATURAL_HTML_INVALID');
      stack.pop();
      continue;
    }
    const opening = /^<([a-z]+)((?:\s+[a-z]+="[^"]*")*)\s*>$/u.exec(token);
    if (!opening || !['table', 'caption', 'thead', 'tbody', 'tfoot', 'tr', 'td', 'th', 'ul', 'ol', 'li', 'br', 'sup'].includes(opening[1]))
      throw new Error('TRANSLATION_NATURAL_HTML_INVALID');
    const attrs = [...opening[2].matchAll(/\s+([a-z]+)="([^"]*)"/gu)]
      .map((match) => ({ name: match[1], value: decodeHtml(match[2]) }));
    if (attrs.length !== new Set(attrs.map((entry) => entry.name)).size ||
        (attrs.length && !['td', 'th'].includes(opening[1])) ||
        attrs.some((entry) => !['rowspan', 'colspan'].includes(entry.name)))
      throw new Error('TRANSLATION_NATURAL_HTML_INVALID');
    const node = { tagName: opening[1], attrs, childNodes: [] };
    stack.at(-1).childNodes.push(node);
    if (opening[1] !== 'br') stack.push(node);
  }
  if (stack.length !== 1) throw new Error('TRANSLATION_NATURAL_HTML_INVALID');
  return root;
}

function decodeHtml(value) {
  return value.replace(/&(#(?:x[0-9a-f]+|[0-9]+)|amp|lt|gt|quot|apos);/giu, (_whole, name) => {
    const named = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
    if (Object.hasOwn(named, name)) return named[name];
    const code = name[1]?.toLowerCase() === 'x' ? Number.parseInt(name.slice(2), 16)
      : Number.parseInt(name.slice(1), 10);
    if (!Number.isInteger(code) || code < 0 || code > 0x10ffff)
      throw new Error('TRANSLATION_NATURAL_HTML_INVALID');
    return String.fromCodePoint(code);
  });
}

function escapeHtml(value) {
  return String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;').replaceAll('"', '&quot;');
}

function rowGroupTag(kind) {
  if (kind === 'header' || kind === 'thead') return 'thead';
  if (kind === 'footer' || kind === 'footnote' || kind === 'tfoot') return 'tfoot';
  return 'tbody';
}

function tableSource(block, anchors) {
  const tables = block.sourceStructure.filter((unit) => unit.kind === 'table');
  if (!tables.length || tables.some((unit) => unit.payload.layout !== 'grid'))
    return block.anchorIds.map((id) => anchors.get(id).sourceText).join('\n');
  return tables.map((unit) => {
    const payload = unit.payload;
    const caption = typeof payload.caption === 'string' && payload.caption.trim()
      ? `<caption>${escapeHtml(payload.caption)}</caption>` : '';
    const columns = (payload.columns ?? []).filter((column) =>
      typeof column.name === 'string' && column.name.trim());
    const columnHead = columns.length
      ? `<thead><tr>${columns.map((column) => `<th>${escapeHtml(column.name)}</th>`).join('')}</tr></thead>` : '';
    const groups = payload.rowGroups.map((group) => {
      const tag = rowGroupTag(group.kind);
      const rows = group.rows.map((row) => {
        const cells = row.cells.map((cell) => {
          const cellTag = cell.isHeader ? 'th' : 'td';
          const spans = `${cell.rowSpan > 1 ? ` rowspan="${cell.rowSpan}"` : ''}${cell.colSpan > 1 ? ` colspan="${cell.colSpan}"` : ''}`;
          const content = (cell.inlineContent ?? []).map((item) =>
            typeof item.text === 'string' ? escapeHtml(item.text) : '').join('<br>');
          return `<${cellTag}${spans}>${content}</${cellTag}>`;
        }).join('');
        return `<tr>${cells}</tr>`;
      }).join('');
      return `<${tag}>${rows}</${tag}>`;
    }).join('');
    return `<table>${caption}${columnHead}${groups}</table>`;
  }).join('\n');
}

function listTree(block) {
  const byId = new Map(block.sourceStructure.map((unit) => [unit.sourceUnitId, unit]));
  const root = block.sourceStructure.find((unit) => unit.kind === 'list');
  if (!root) throw new Error('TRANSLATION_LIST_ALIGNMENT_UNSUPPORTED');
  const visit = (unit, path) => {
    if (path.has(unit.sourceUnitId)) throw new Error('TRANSLATION_LIST_ALIGNMENT_UNSUPPORTED');
    const nextPath = new Set([...path, unit.sourceUnitId]);
    const first = byId.get((unit.payload.itemUnitIds ?? [])[0]);
    const tag = unit.payload.ordered === true || unit.payload.listType === 'ordered' ||
      /^\d+[.)]/u.test(String(unit.payload.marker ?? first?.payload.text ?? '')) ? 'ol' : 'ul';
    const items = [];
    for (const id of unit.payload.itemUnitIds ?? []) {
      const child = byId.get(id);
      if (!child) throw new Error('TRANSLATION_LIST_ALIGNMENT_UNSUPPORTED');
      if (child.kind === 'list') {
        if (!items.length) throw new Error('TRANSLATION_LIST_ALIGNMENT_UNSUPPORTED');
        items.at(-1).nested.push(visit(child, nextPath));
      } else if (child.kind === 'list_item') {
        items.push({ unit: child, nested: [] });
      } else throw new Error('TRANSLATION_LIST_ALIGNMENT_UNSUPPORTED');
    }
    return { tag, items };
  };
  return visit(root, new Set());
}

function renderList(tree, block, anchors) {
  return `<${tree.tag}>${tree.items.map((item) => {
    const text = block.anchorIds.filter((id) => anchors.get(id).sourceUnitId === item.unit.sourceUnitId)
      .map((id) => anchors.get(id).sourceText).join(' ');
    return `<li>${escapeHtml(text)}${item.nested.map((nested) => renderList(nested, block, anchors)).join('')}</li>`;
  }).join('')}</${tree.tag}>`;
}

function blockSource(block, anchors) {
  if (block.kind === 'table') return tableSource(block, anchors);
  if (block.kind === 'list') {
    if (block.sourceStructure.some((unit) => unit.kind === 'list_item'))
      return renderList(listTree(block), block, anchors);
  }
  const text = block.anchorIds.map((id) => anchors.get(id).sourceText).join('\n');
  if (block.kind === 'heading') {
    const level = Number(block.sourceStructure[0]?.payload.level);
    return `${'#'.repeat(Number.isInteger(level) && level > 0 && level <= 6 ? level : 2)} ${text}`;
  }
  return text;
}

function assertProjectionCoverage(block, anchors) {
  if (block.kind === 'list' && block.sourceStructure.some((unit) => unit.kind === 'list_item')) {
    const items = new Set(block.sourceStructure.filter((unit) => unit.kind === 'list_item')
      .map((unit) => unit.sourceUnitId));
    if (block.anchorIds.some((id) => !items.has(anchors.get(id).sourceUnitId)))
      throw new Error('TRANSLATION_LIST_ALIGNMENT_UNSUPPORTED');
  }
  if (block.kind !== 'table') return;
  const tables = block.sourceStructure.filter((unit) => unit.kind === 'table');
  if (!tables.length || tables.some((unit) => unit.payload.layout !== 'grid')) return;
  for (const id of block.anchorIds) {
    const anchor = anchors.get(id);
    const unit = tables.find((entry) => entry.sourceUnitId === anchor.sourceUnitId);
    if (!unit) throw new Error('TRANSLATION_TABLE_ALIGNMENT_UNSUPPORTED');
    const parts = anchor.payloadPath.split('/').slice(2);
    let value = unit.payload;
    for (const part of parts) value = value?.[part];
    if (value !== anchor.sourceText ||
        !(/^\/payload\/(caption|columns\/\d+\/name)$/u.test(anchor.payloadPath) ||
          /^\/payload\/rowGroups\/\d+\/rows\/\d+\/cells\/\d+\/inlineContent\/\d+\/text$/u.test(anchor.payloadPath)))
      throw new Error('TRANSLATION_TABLE_ALIGNMENT_UNSUPPORTED');
  }
}

function significant(nodes) {
  return nodes.filter((node) => node.nodeName !== '#text' || node.value.trim());
}

function child(node, name) {
  return significant(node.childNodes ?? []).filter((entry) => entry.tagName === name);
}

function textContent(node) {
  if (node.nodeName === '#text') return node.value;
  if (node.tagName === 'br') return '\n';
  if (!['td', 'th', 'caption', 'li', 'sup'].includes(node.tagName))
    throw new Error('TRANSLATION_NATURAL_HTML_INVALID');
  if (node.childNodes?.some((child) => child.nodeName !== '#text' &&
      !['br', 'sup'].includes(child.tagName)))
    throw new Error('TRANSLATION_NATURAL_HTML_INVALID');
  return (node.childNodes ?? []).map(textContent).join('');
}

function span(node, name) {
  const value = node.attrs?.find((attribute) => attribute.name === name)?.value;
  if (value === undefined) return 1;
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1) throw new Error('TRANSLATION_TABLE_TOPOLOGY_CHANGED');
  return number;
}

function checkCellLiterals(source, translated) {
  const numbers = (value) => (value.match(/\d+/gu) ?? [])
    .map((item) => String(Number(item))).sort();
  const identifiers = (value) => (value.match(/\b(?=[A-Za-z0-9-]*\d)[A-Za-z][A-Za-z0-9-]*\b/gu) ?? [])
    .map((item) => item.toUpperCase()).sort();
  const footnotes = (value) => (value.match(/[†‡※]|\[\d+\]|\(\d+\)/gu) ?? []).sort();
  if (JSON.stringify(numbers(source)) !== JSON.stringify(numbers(translated)) ||
      JSON.stringify(identifiers(source)) !== JSON.stringify(identifiers(translated)) ||
      JSON.stringify(footnotes(source)) !== JSON.stringify(footnotes(translated)))
    throw new Error('TRANSLATION_TABLE_VALUE_MISMATCH');
}

function tableElements(block, anchors, markdown) {
  const expected = block.sourceStructure.filter((unit) => unit.kind === 'table');
  if (!expected.length || expected.some((unit) => unit.payload.layout !== 'grid'))
    throw new Error('TRANSLATION_TABLE_ALIGNMENT_UNSUPPORTED');
  const root = parseFragment(markdown);
  const tables = significant(root.childNodes).filter((node) => node.tagName === 'table');
  if (tables.length !== expected.length || significant(root.childNodes).length !== tables.length)
    throw new Error('TRANSLATION_TABLE_TOPOLOGY_CHANGED');
  const elements = [];
  for (let tableIndex = 0; tableIndex < expected.length; tableIndex++) {
    const unit = expected[tableIndex];
    const source = unit.payload;
    const target = tables[tableIndex];
    const caption = child(target, 'caption');
    const sourceCaption = typeof source.caption === 'string' && source.caption.trim();
    if (caption.length !== (sourceCaption ? 1 : 0))
      throw new Error('TRANSLATION_TABLE_TOPOLOGY_CHANGED');
    if (caption.length) {
      const ids = block.anchorIds.filter((id) => anchors.get(id).sourceUnitId === unit.sourceUnitId &&
        anchors.get(id).payloadPath === '/payload/caption');
      if (ids.length !== 1 || !textContent(caption[0]).trim())
        throw new Error('TRANSLATION_TABLE_ALIGNMENT_UNSUPPORTED');
      elements.push({ kind: 'caption', translatedText: textContent(caption[0]).trim(), anchorIds: ids });
    }
    const groups = significant(target.childNodes).filter((node) => node.tagName !== 'caption');
    const columns = (source.columns ?? []).map((column, index) => ({ column, index }))
      .filter(({ column }) => typeof column.name === 'string' && column.name.trim());
    if (columns.length) {
      const header = groups.shift();
      const headerRows = header?.tagName === 'thead' ? significant(header.childNodes) : [];
      const headerCells = headerRows.length === 1 && headerRows[0].tagName === 'tr'
        ? significant(headerRows[0].childNodes) : [];
      if (headerCells.length !== columns.length || headerCells.some((cell) => cell.tagName !== 'th'))
        throw new Error('TRANSLATION_TABLE_TOPOLOGY_CHANGED');
      for (let index = 0; index < columns.length; index++) {
        const ids = block.anchorIds.filter((id) => anchors.get(id).sourceUnitId === unit.sourceUnitId &&
          anchors.get(id).payloadPath === `/payload/columns/${columns[index].index}/name`);
        const translatedText = textContent(headerCells[index]).trim();
        if (ids.length !== 1 || !translatedText ||
            span(headerCells[index], 'rowspan') !== 1 ||
            span(headerCells[index], 'colspan') !== 1)
          throw new Error('TRANSLATION_TABLE_ALIGNMENT_UNSUPPORTED');
        elements.push({ kind: 'label', translatedText, anchorIds: ids });
      }
    }
    if (groups.length !== source.rowGroups.length) throw new Error('TRANSLATION_TABLE_TOPOLOGY_CHANGED');
    for (let groupIndex = 0; groupIndex < groups.length; groupIndex++) {
      const sourceGroup = source.rowGroups[groupIndex];
      const targetGroup = groups[groupIndex];
      if (targetGroup.tagName !== rowGroupTag(sourceGroup.kind))
        throw new Error('TRANSLATION_TABLE_TOPOLOGY_CHANGED');
      const rows = significant(targetGroup.childNodes);
      if (rows.length !== sourceGroup.rows.length || rows.some((row) => row.tagName !== 'tr'))
        throw new Error('TRANSLATION_TABLE_TOPOLOGY_CHANGED');
      for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
        const sourceCells = sourceGroup.rows[rowIndex].cells;
        const targetCells = significant(rows[rowIndex].childNodes);
        if (targetCells.length !== sourceCells.length) throw new Error('TRANSLATION_TABLE_TOPOLOGY_CHANGED');
        for (let cellIndex = 0; cellIndex < targetCells.length; cellIndex++) {
          const sourceCell = sourceCells[cellIndex];
          const targetCell = targetCells[cellIndex];
          if (targetCell.tagName !== (sourceCell.isHeader ? 'th' : 'td') ||
              span(targetCell, 'rowspan') !== (sourceCell.rowSpan ?? 1) ||
              span(targetCell, 'colspan') !== (sourceCell.colSpan ?? 1))
            throw new Error('TRANSLATION_TABLE_TOPOLOGY_CHANGED');
          const prefix = `/payload/rowGroups/${groupIndex}/rows/${rowIndex}/cells/${cellIndex}/inlineContent/`;
          const ids = block.anchorIds.filter((id) => anchors.get(id).sourceUnitId === unit.sourceUnitId &&
            anchors.get(id).payloadPath.startsWith(prefix));
          const translatedText = textContent(targetCell).trim();
          if (ids.length && !translatedText || !ids.length && translatedText)
            throw new Error('TRANSLATION_TABLE_ALIGNMENT_UNSUPPORTED');
          if (ids.length) {
            checkCellLiterals(ids.map((id) => anchors.get(id).sourceText).join(' '), translatedText);
            elements.push({ kind: 'table_cell', translatedText, anchorIds: ids });
          }
        }
      }
    }
  }
  const covered = new Set(elements.flatMap((entry) => entry.anchorIds));
  if (block.anchorIds.some((id) => !covered.has(id)))
    throw new Error('TRANSLATION_TABLE_ALIGNMENT_UNSUPPORTED');
  return elements;
}

function listElements(block, anchors, markdown) {
  const root = parseFragment(markdown);
  const lists = significant(root.childNodes);
  if (lists.length !== 1 || !['ul', 'ol'].includes(lists[0].tagName))
    throw new Error('TRANSLATION_LIST_TOPOLOGY_CHANGED');
  const elements = [];
  const visit = (source, target) => {
    if (target.tagName !== source.tag) throw new Error('TRANSLATION_LIST_TOPOLOGY_CHANGED');
    const translated = significant(target.childNodes);
    if (translated.length !== source.items.length || translated.some((item) => item.tagName !== 'li'))
      throw new Error('TRANSLATION_LIST_TOPOLOGY_CHANGED');
    source.items.forEach((item, index) => {
      const nodes = significant(translated[index].childNodes);
      const nested = nodes.filter((node) => ['ul', 'ol'].includes(node.tagName));
      if (nested.length !== item.nested.length || nodes.some((node) =>
        node.nodeName !== '#text' && !['br', 'sup', 'ul', 'ol'].includes(node.tagName)))
        throw new Error('TRANSLATION_LIST_TOPOLOGY_CHANGED');
      const text = nodes.filter((node) => !['ul', 'ol'].includes(node.tagName))
        .map(textContent).join('').trim();
      const ids = block.anchorIds.filter((id) => anchors.get(id).sourceUnitId === item.unit.sourceUnitId);
      if (ids.length && !text || !ids.length && text)
        throw new Error('TRANSLATION_LIST_ALIGNMENT_UNSUPPORTED');
      if (ids.length) elements.push({ kind: 'list_item', translatedText: text, anchorIds: ids });
      item.nested.forEach((child, childIndex) => visit(child, nested[childIndex]));
    });
  };
  visit(listTree(block), lists[0]);
  return elements;
}

function plainElements(block, markdown) {
  if (!block.anchorIds.length) {
    if (markdown.trim()) throw new Error('TRANSLATION_STRUCTURE_ONLY_OUTPUT_INVALID');
    return [];
  }
  const kind = block.kind === 'heading' ? 'heading' : block.kind === 'advisory' ? 'advisory' : 'paragraph';
  const body = kind === 'heading' ? markdown.trim().replace(/^#{1,6}\s+/u, '') : markdown.trim();
  const paragraphs = kind === 'heading' ? [body] : body.split(/\n\s*\n/u).map((text) => text.trim());
  if (paragraphs.some((text) => !text)) throw new Error('TRANSLATION_NATURAL_SECTION_EMPTY');
  return paragraphs.map((translatedText) => ({ kind, translatedText, anchorIds: [...block.anchorIds] }));
}

function parseSections(markdown, markers) {
  const sections = new Map();
  let previousEnd = 0;
  let previousMarker = null;
  for (const match of markdown.matchAll(MARKER)) {
    if (previousMarker === null) {
      if (markdown.slice(0, match.index).trim()) throw new Error('TRANSLATION_NATURAL_BOUNDARY_INVALID');
    } else {
      sections.set(previousMarker, markdown.slice(previousEnd, match.index).trim());
    }
    const marker = Number(match[1]);
    if (sections.has(marker) || previousMarker === marker)
      throw new Error('TRANSLATION_NATURAL_BOUNDARY_INVALID');
    previousMarker = marker;
    previousEnd = match.index + match[0].length;
  }
  if (previousMarker !== null) sections.set(previousMarker, markdown.slice(previousEnd).trim());
  if (sections.size !== markers.length || markers.some((marker, index) =>
    [...sections.keys()][index] !== marker))
    throw new Error('TRANSLATION_NATURAL_BOUNDARY_INVALID');
  return sections;
}

export function buildNaturalTranslationProjection(batch) {
  const allBlocks = [...batch.blocks, ...(batch.documentContext.blocks ?? [])]
    .sort((a, b) => a.order - b.order);
  const allAnchors = [...batch.anchors, ...(batch.documentContext.anchors ?? [])];
  const anchors = new Map(allAnchors.map((anchor) => [anchor.anchorId, anchor]));
  const assignedAnchors = allBlocks.flatMap((block) => block.anchorIds);
  if (anchors.size !== allAnchors.length || new Set(allBlocks.map((block) => block.blockId)).size !== allBlocks.length ||
      allBlocks.some((block) => block.anchorIds.some((id) => !anchors.has(id))) ||
      assignedAnchors.length !== allAnchors.length || new Set(assignedAnchors).size !== allAnchors.length)
    throw new Error('TRANSLATION_NATURAL_SOURCE_INVALID');
  // Old REGISTERED requests retain their original dependency scope. They
  // cannot be silently expanded into the new full-document input.
  if (allAnchors.length !== batch.sourcePlanAnchorCount ||
      allBlocks.length !== batch.sourcePlanBlockCount)
    throw new Error('TRANSLATION_FULL_DOCUMENT_CONTEXT_REQUIRED');
  const markers = new Map(allBlocks.map((block, index) => [block.blockId, index + 1]));
  allBlocks.forEach((block) => assertProjectionCoverage(block, anchors));
  const input = {
    schemaVersion: 'wiselink.3_1.translation_natural_document.v1',
    sourceLocale: batch.sourceLocale, targetLocale: batch.targetLocale,
    document: allBlocks.map((block) => `<!-- WL-SECTION:${markers.get(block.blockId)} -->\n${blockSource(block, anchors)}`).join('\n\n'),
    targetSections: batch.blocks.map((block) => markers.get(block.blockId)),
    readingNotes: allBlocks.flatMap((block) => (block.sourceIssues ?? [])
      .filter((issue) => issue.origin === 'SOURCE')
      .map((issue) => ({ section: markers.get(block.blockId), severity: issue.severity,
        code: issue.code, message: issue.message }))),
    conditionScopes: (batch.documentContext.scopedConditions ?? []).map((scope) => ({
      advisorySection: markers.get(scope.advisoryBlockId),
      targetSections: scope.targetBlockIds.map((id) => markers.get(id)),
    })),
    terminology: structuredClone(batch.terminology),
  };
  return { input, restoreOutput(output) {
    if (!output || typeof output !== 'object' || Array.isArray(output) ||
        Object.keys(output).length !== 1 || typeof output.markdown !== 'string')
      throw new Error('TRANSLATION_NATURAL_OUTPUT_INVALID');
    const sections = parseSections(output.markdown, input.targetSections);
    return { blocks: batch.blocks.map((block) => {
      const markdown = sections.get(markers.get(block.blockId));
      const gridTable = block.kind === 'table' && block.sourceStructure.some((unit) =>
        unit.kind === 'table' && unit.payload.layout === 'grid');
      const structuredList = block.kind === 'list' && block.sourceStructure.some((unit) =>
        unit.kind === 'list_item');
      const elements = gridTable ? tableElements(block, anchors, markdown)
        : structuredList ? listElements(block, anchors, markdown)
          : plainElements(block, markdown);
      return { blockId: block.blockId, elements };
    }) };
  } };
}
