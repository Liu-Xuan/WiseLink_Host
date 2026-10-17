// Pure SB consumer model selectively vendored from Source 0.2.73 / handoff @8.
import { tdmsError } from './tdms-source.types';
// This self-contained factory is also the browser-side shared validator. Keep
// source facts here; the producer cannot pass a completeness exemption.
export function createReviewedSbNativeTreeTools() {
  const model = Object.freeze({
    modelRevision: 'tdms-reviewed-sb-document-native-tree@1',
    scopeIds: Object.freeze(['SB', 'SIL', 'SB-IN', 'SL', 'MT']),
    nativeTypeId: 'WCTYPE|wt.doc.WTDocument|com.airchina.SBDocument',
    nativeHeaderType: 'SB文档',
    tabId: 'infoPageinfoPanelID__infoPage_myTab_object_sbRelatedTab',
    panelLocator: '#infoPage_myTab_object_sbRelatedTab',
    gridId: 'mytreetable',
    tableTitle: 'SB RelationShip',
    numberRole: 'SB_NATIVE_NUMBER_REFERENCE',
    scopeMeaning: 'EXACT_OWNER_CURRENT_NATIVE_SB_RELATE_TREE',
    inputSha256:
      'c40c488ed7ba7c3e052ce7fa2bbc65f9a513f8223f993010cc96403f4a6480c0',
    numberTreeSha256:
      'da841d28c1ec04dabddc78c8442b92459268619716baabed7bdcc07444a5bd1b',
    // SB's own normal expansion produced this explicit terminal marker at
    // depth 2. Its meaning is independent of AD's depth or classification.
    leafMarkerInputSha256:
      'f014ddeee8eed2130e315e04b1bc2396e06644a24d45d3461161066af745b1af',
    leafMarkerSecondInputSha256:
      'bda8b3d672601a3b0bafce34731565108ca9063bd08f54def6c27e7699b6d19c',
    reviewedLeafMarkers: Object.freeze(['ux-maximgb-tg-elbow-end']),
    targetIndicators: Object.freeze([
      Object.freeze({
        scopeId: 'SB_PROCESSING_FORM',
        nativeClass: 'wt.change2.WTChangeRequest2',
        title: 'SB处理单',
        src: 'netmarkets/images/chgreqst.gif',
      }),
      Object.freeze({
        scopeId: 'SB_ASSESSMENT_FORM',
        nativeClass: 'wt.change2.WTChangeOrder2',
        title: 'SB评估单',
        src: 'netmarkets/images/chgnotice.gif',
      }),
    ]),
    columns: Object.freeze(
      [
        ['Object Type Indicator', 'type_icon'],
        ['Number', 'number'],
        ['View Information', 'infoPageAction'],
        ['Primary Content', 'primaryAttachmentProperties'],
        ['Name', 'name'],
        ['SB处理单编号', 'IBA|BizNo'],
        ['State', 'state'],
        ['Created By', 'creator'],
        ['Last Modified', 'thePersistInfo_modifyStamp'],
      ].map(([actualLabel, nativeColumnToken]) =>
        Object.freeze({ actualLabel, nativeColumnToken }),
      ),
    ),
  });
  const fail = (code = 'TDMS_COMPLETE_SB_NATIVE_TREE_INVALID') => {
    throw tdmsError(code);
  };
  const stable = (value) =>
    JSON.stringify(
      (function order(v) {
        if (Array.isArray(v)) return v.map(order);
        if (v && typeof v === 'object')
          return Object.fromEntries(
            Object.keys(v)
              .sort()
              .map((k) => [k, order(v[k])]),
          );
        return v;
      })(value),
    );
  const same = (a, b) => stable(a) === stable(b);
  const keys = (v, list) =>
    v &&
    typeof v === 'object' &&
    !Array.isArray(v) &&
    Object.keys(v).length === list.length &&
    list.every((k) => Object.hasOwn(v, k));
  const raw = (v, max = 500) =>
    typeof v === 'string' && !!v.trim() && v.length <= max;
  const tokens = (v) =>
    typeof v === 'string' ? v.trim().split(/\s+/u).filter(Boolean) : [];
  const ref = (v) => /^(?:OR|VR):[A-Za-z0-9_.]+:\d{1,24}$/u.test(v || '');
  function hrefTarget(value) {
    let url;
    try {
      url = new URL(value, 'http://tdms.airchina.com/Windchill/');
    } catch {
      return null;
    }
    const fragment = new URLSearchParams(url.hash.split('?')[1] || '');
    const params = [...url.searchParams, ...fragment];
    if (
      url.origin !== 'http://tdms.airchina.com' ||
      url.username ||
      url.password ||
      params.some(([k]) => /token|auth|sig|session|ticket/iu.test(k)) ||
      !(
        url.pathname.endsWith('/tcomp/infoPage') ||
        /^#ptc\d+\/tcomp\/infoPage(?:\?|$)/u.test(url.hash)
      )
    )
      return null;
    const ids = params.filter(([k]) => k === 'oid').map(([, v]) => v);
    return ids.length === 1 && ref(ids[0]) ? ids[0] : null;
  }
  function ownerMatches(scopeId, owner) {
    return (
      model.scopeIds.includes(scopeId) &&
      /^(?:OR|VR):wt\.doc\.WTDocument:\d{1,24}$/u.test(
        owner?.sourceRecordId || '',
      ) &&
      owner.nativeTypeId === model.nativeTypeId &&
      owner.nativeTypeEvidence?.state === 'VALUE' &&
      owner.nativeTypeEvidence.rawValue === model.nativeTypeId &&
      owner.rawHeaderType === model.nativeHeaderType &&
      owner.scopeEvidence?.businessType === scopeId &&
      raw(owner.number) &&
      raw(owner.rawHeaderIdentifier) &&
      owner.rawHeaderIdentifier.split(',')[0].trim() === owner.number &&
      raw(owner.sourceModifiedRaw) &&
      raw(owner.stateRaw) &&
      owner.sourceVersion?.confirmation === 'SOURCE_DECLARED' &&
      raw(owner.sourceVersion.rawRevision, 100) &&
      /^\d{1,20}$/u.test(owner.sourceVersion.rawIteration || '') &&
      owner.rawHeaderIdentifier.split(',').at(-1).trim() ===
        owner.sourceVersion.rawRevision + '.' + owner.sourceVersion.rawIteration
    );
  }
  function tableMatches({ scopeId, owner, table } = {}) {
    return (
      ownerMatches(scopeId, owner) &&
      table?.gridId === model.gridId &&
      table.tableId === model.gridId &&
      table.tabId === model.tabId &&
      table.panelLocator === model.panelLocator
    );
  }
  function shapeState(shape) {
    if (
      !shape ||
      !Array.isArray(shape.elbows) ||
      !shape.elbows.length ||
      shape.elbows.length > 33 ||
      !keys(shape.uiWrap, ['class', 'style']) ||
      shape.uiWrap.class !== 'ux-maximgb-tg-uiwrap'
    )
      fail();
    const depth = shape.elbows.length - 1,
      classes = tokens(shape.rowClass);
    const levels = classes.filter((c) => c.startsWith('ux-maximgb-tg-level-'));
    if (
      !classes.includes('x-grid3-row') ||
      levels.length > 1 ||
      shape.levelClass !== (levels[0] ?? null) ||
      (levels.length === 1 && levels[0] !== 'ux-maximgb-tg-level-' + depth) ||
      !tokens(shape.numberCellClass).includes('x-grid3-td-number')
    )
      fail();
    if (shape.uiWrap.style !== null) {
      const width =
        typeof shape.uiWrap.style === 'string' &&
        shape.uiWrap.style.match(/^\s*width:\s*(\d+)px\s*;?\s*$/u);
      if (!width || Number(width[1]) !== 16 * (depth + 1)) fail();
    }
    for (const [j, e] of shape.elbows.entries()) {
      const left =
        typeof e?.style === 'string' &&
        e.style.match(/^\s*left:\s*(\d+)px\s*;?\s*$/u);
      if (
        !keys(e, ['class', 'style']) ||
        !left ||
        Number(left[1]) !== (j === depth ? 1 + 16 * depth : 16 * j) ||
        (j < depth &&
          !['ux-maximgb-tg-elbow-empty', 'ux-maximgb-tg-elbow-line'].includes(
            e.class,
          ))
      )
        fail();
    }
    const marker = shape.elbows[depth].class;
    const branch = marker?.match(
      /^ux-maximgb-tg-elbow-active ux-maximgb-tg-elbow-(end-)?(plus|minus)$/u,
    );
    const explicitLeaf = [
      'ux-maximgb-tg-elbow',
      'ux-maximgb-tg-elbow-end',
    ].includes(marker);
    if (!branch && !explicitLeaf)
      fail('TDMS_COMPLETE_SB_NATIVE_TREE_MARKER_UNREVIEWED');
    return {
      depth,
      end: branch ? !!branch[1] : marker.endsWith('-end'),
      collapsed: branch?.[2] === 'plus',
      expanded: branch?.[2] === 'minus',
      explicitLeaf,
      reviewedLeaf:
        explicitLeaf &&
        /^[a-f0-9]{64}$/u.test(model.leafMarkerInputSha256 || '') &&
        model.reviewedLeafMarkers.includes(marker),
    };
  }
  // Sibling positions identify relation occurrences. Target OIDs never identify
  // rows: duplicates and cycles remain observable independent occurrences.
  function bind(rows, rowShapes) {
    if (
      !Array.isArray(rows) ||
      !rows.length ||
      rows.length > 1000 ||
      rows.length !== rowShapes?.length
    )
      fail();
    const out = JSON.parse(JSON.stringify({ rows, rowShapes })),
      stack = [],
      counters = new Map();
    for (const [i, row] of out.rows.entries()) {
      const shape = out.rowShapes[i],
        state = shapeState(shape),
        depth = state.depth;
      if (
        depth > stack.length ||
        (depth === 0 && i !== 0) ||
        !ref(row.sourceLinks?.[0]?.targetRef)
      )
        fail();
      if (depth && !stack[depth - 1]?.state.expanded) fail();
      stack.length = depth;
      const parent = stack.at(-1),
        parentKey = parent?.shape.siblingPath.join('.') ?? '';
      const position = counters.get(parentKey) ?? 0;
      counters.set(parentKey, position + 1);
      shape.siblingPath = [...(parent?.shape.siblingPath || []), position];
      shape.domOrdinal = i;
      row.occurrenceId =
        model.gridId + ':SB_NATIVE:' + shape.siblingPath.join('.');
      shape.occurrenceId = row.occurrenceId;
      row.treeDepth = depth;
      row.treePath = [
        ...stack.map((v) => v.row.sourceLinks[0].targetRef),
        row.sourceLinks[0].targetRef,
      ];
      for (let j = 0; j < depth; j++)
        if (
          shape.elbows[j].class !==
          (stack[j].state.end
            ? 'ux-maximgb-tg-elbow-empty'
            : 'ux-maximgb-tg-elbow-line')
        )
          fail();
      stack.push({ row, shape, state });
    }
    for (const [i] of out.rows.entries()) {
      const state = shapeState(out.rowShapes[i]),
        next = out.rows[i + 1];
      if (state.expanded && (!next || next.treeDepth !== state.depth + 1))
        fail('TDMS_COMPLETE_SB_NATIVE_TREE_EXPANDED_CHILD_UNREAD');
      let sibling = false;
      for (
        let j = i + 1;
        j < out.rows.length && out.rows[j].treeDepth >= state.depth;
        j++
      ) {
        if (out.rows[j].treeDepth === state.depth) {
          sibling = true;
          break;
        }
      }
      if (state.end === sibling)
        fail('TDMS_COMPLETE_SB_NATIVE_TREE_SIBLING_END_UNPROVEN');
    }
    return out;
  }
  function rowIdentity(value) {
    return JSON.stringify(
      (function strip(v) {
        if (Array.isArray(v)) return v.map(strip);
        if (v && typeof v === 'object')
          return Object.fromEntries(
            Object.keys(v)
              .sort()
              .filter(
                (k) =>
                  ![
                    'locator',
                    'rowLocator',
                    'occurrenceId',
                    'domOrdinal',
                  ].includes(k),
              )
              .map((k) => [k, strip(v[k])]),
          );
        return v;
      })(value),
    );
  }
  function validateQuery(query) {
    if (
      !keys(query, [
        'scope',
        'controls',
        'explicitMarkers',
        'pagerControls',
        'loading',
      ]) ||
      query.scope !== model.scopeMeaning ||
      !Array.isArray(query.controls) ||
      query.controls.length !== 1 ||
      !Array.isArray(query.explicitMarkers) ||
      !Array.isArray(query.pagerControls) ||
      !Array.isArray(query.loading)
    )
      fail('TDMS_COMPLETE_SB_NATIVE_TREE_QUERY_UNREVIEWED');
    const c = query.controls[0];
    if (
      !keys(c, ['tag', 'rawClassName', 'type', 'name', 'disabled']) ||
      c.tag !== 'BUTTON' ||
      !raw(c.rawClassName, 300) ||
      c.rawClassName.trim() !== 'x-btn-text expandCollapse_collapsed' ||
      c.type !== 'button' ||
      c.name !== null ||
      c.disabled !== false ||
      query.explicitMarkers.length ||
      query.pagerControls.length ||
      query.loading.length
    )
      fail('TDMS_COMPLETE_SB_NATIVE_TREE_QUERY_UNREVIEWED');
    return true;
  }
  function validateMetadata(metadata, rows) {
    if (!Array.isArray(metadata) || metadata.length !== rows.length) fail();
    for (const [i, entry] of metadata.entries()) {
      if (
        !keys(entry, ['occurrenceId', 'rowLocator', 'columns']) ||
        entry.occurrenceId !== rows[i].occurrenceId ||
        !raw(entry.rowLocator, 700) ||
        !Array.isArray(entry.columns) ||
        entry.columns.length !== 9
      )
        fail();
      for (const [j, c] of entry.columns.entries()) {
        const spec = model.columns[j];
        if (
          !keys(c, [
            'nativeColumnToken',
            'actualLabel',
            'locator',
            'readState',
            'rawText',
            'nativeRefs',
            'images',
            'sourceVersionBinding',
            'originalBinding',
            'bytesCollected',
          ]) ||
          c.nativeColumnToken !== spec.nativeColumnToken ||
          c.actualLabel !== spec.actualLabel ||
          c.locator !==
            entry.rowLocator +
              ' td.x-grid3-cell[class~="x-grid3-td-' +
              spec.nativeColumnToken +
              '"]' ||
          !['VALUE', 'BLANK', 'NOT_READ', 'ACCESS_DENIED'].includes(
            c.readState,
          ) ||
          (c.rawText !== null &&
            (typeof c.rawText !== 'string' || [...c.rawText].length > 12000)) ||
          !Array.isArray(c.nativeRefs) ||
          c.nativeRefs.length > 12 ||
          !Array.isArray(c.images) ||
          c.images.length > 6 ||
          c.sourceVersionBinding !== 'UNCONFIRMED' ||
          c.originalBinding !== 'UNCONFIRMED' ||
          c.bytesCollected !== false
        )
          fail();
        for (const a of c.nativeRefs) {
          if (
            !keys(a, ['rawHref', 'targetRef', 'locator', 'nativeRefs']) ||
            !raw(a.rawHref, 2000) ||
            !raw(a.locator, 700) ||
            (a.targetRef !== null && !ref(a.targetRef)) ||
            !Array.isArray(a.nativeRefs) ||
            a.nativeRefs.length > 12
          )
            fail();
          let url;
          try {
            url = new URL(a.rawHref, 'http://tdms.airchina.com/Windchill/');
          } catch {
            fail();
          }
          const params = [
            ...url.searchParams,
            ...new URLSearchParams(url.hash.split('?')[1] || ''),
          ];
          const actual = params
            .filter(([, v]) =>
              /^(?:(?:OR|VR):)?(?:wt\.[A-Za-z0-9_.]+):\d{1,24}$/u.test(v),
            )
            .map(([parameter, rawValue]) => ({ parameter, rawValue }));
          if (
            url.origin !== 'http://tdms.airchina.com' ||
            url.username ||
            url.password ||
            params.some(([k]) => /token|auth|sig|session|ticket/iu.test(k)) ||
            !same(actual, a.nativeRefs) ||
            (a.targetRef !== null && hrefTarget(a.rawHref) !== a.targetRef)
          )
            fail();
        }
        for (const img of c.images)
          if (
            !keys(img, ['src', 'title']) ||
            !raw(img.src, 2000) ||
            (img.title !== null &&
              (typeof img.title !== 'string' || img.title.length > 500))
          )
            fail();
        if (
          c.readState === 'BLANK' &&
          (typeof c.rawText !== 'string' ||
            c.rawText.trim() ||
            c.nativeRefs.length ||
            c.images.length)
        )
          fail();
        if (
          ['NOT_READ', 'ACCESS_DENIED'].includes(c.readState) &&
          (c.rawText !== null || c.nativeRefs.length || c.images.length)
        )
          fail();
        if (
          c.readState === 'VALUE' &&
          c.rawText === null &&
          !c.nativeRefs.length &&
          !c.images.length
        )
          fail();
        if (
          j === 1 &&
          (c.readState !== 'VALUE' ||
            c.rawText?.trim() !== rows[i].sourceLinks[0].numberRaw ||
            c.nativeRefs.length !== 1 ||
            c.nativeRefs[0].targetRef !== rows[i].sourceLinks[0].targetRef)
        )
          fail();
        if (
          j === 2 &&
          c.readState === 'VALUE' &&
          (c.nativeRefs.length !== 1 ||
            c.nativeRefs[0].targetRef !== rows[i].sourceLinks[0].targetRef)
        )
          fail('TDMS_COMPLETE_SB_NATIVE_TREE_METADATA_TARGET_CHANGED');
        // Preserve creator references without reading the person's display text.
        if (
          j === 7 &&
          (c.rawText !== null ||
            (c.readState === 'VALUE' &&
              (c.nativeRefs.length !== 1 ||
                !/^OR:wt\.org\.WTUser:\d{1,24}$/u.test(
                  c.nativeRefs[0].targetRef || '',
                ))))
        )
          fail();
      }
    }
  }
  function metadataComplete(metadata) {
    return metadata.every(({ columns: c }) =>
      c.every((v, j) => {
        if (!['VALUE', 'BLANK'].includes(v.readState)) return false;
        if (j === 0) return v.readState === 'VALUE' && v.images.length === 1;
        if (j === 1 || j === 2 || j === 7) return v.readState === 'VALUE';
        if ([4, 6, 8].includes(j))
          return v.readState === 'VALUE' && raw(v.rawText, 12000);
        return true;
      }),
    );
  }
  function validatePhase(phase, table, owner) {
    if (
      !keys(phase, [
        'ordinal',
        'rows',
        'rowShapes',
        'rowMetadata',
        'query',
        'rawCount',
        'reportedTotal',
        'windowOrdinals',
      ]) ||
      !Array.isArray(phase.rows) ||
      !phase.rows.length ||
      phase.rows.length !== phase.rowShapes?.length ||
      phase.reportedTotal !== phase.rows.length ||
      !/^\(\s*\d+\s+objects?\s*\)$/iu.test(phase.rawCount || '') ||
      Number(phase.rawCount.match(/\d+/u)[0]) !== phase.reportedTotal
    )
      fail();
    validateQuery(phase.query);
    const rebuilt = bind(phase.rows, phase.rowShapes);
    if (
      !same(rebuilt.rows, phase.rows) ||
      !same(rebuilt.rowShapes, phase.rowShapes)
    )
      fail();
    validateMetadata(phase.rowMetadata, phase.rows);
    let ownerSeen = 0;
    for (const [i, row] of phase.rows.entries()) {
      const shape = phase.rowShapes[i],
        link = row.sourceLinks?.[0];
      if (
        !keys(shape, [
          'occurrenceId',
          'rowClass',
          'numberCellClass',
          'levelClass',
          'uiWrap',
          'elbows',
          'numberLink',
          'domOrdinal',
          'siblingPath',
        ]) ||
        !keys(shape.numberLink, ['rawHref', 'locator', 'targetRef']) ||
        row.nativeRowId !== null ||
        row.globalIndex !== null ||
        row.rawRole !== null ||
        row.rawDirection !== null ||
        row.nativeRelationId !== null ||
        row.sourceLinks.length !== 1 ||
        link.nativeRole !== model.numberRole ||
        link.nativeColumnLabel !== 'Number' ||
        link.nativeColumnToken !== 'number' ||
        hrefTarget(link.rawHref) !== link.targetRef ||
        !same(shape.numberLink, {
          rawHref: link.rawHref,
          locator: link.locator,
          targetRef: link.targetRef,
        }) ||
        row.cells?.length !== 9 ||
        row.observedVersion?.confirmation !== 'VERSION_UNCONFIRMED' ||
        row.observedVersion.rawRevision !== null ||
        row.observedVersion.rawIteration !== null
      )
        fail();
      for (const [j, c] of row.cells.entries())
        if (
          c.actualLabel !== model.columns[j].actualLabel ||
          (j === 1 &&
            (c.state !== 'VALUE' ||
              c.rawValue !== link.numberRaw ||
              c.observedTotalCodepoints !== [...link.numberRaw].length)) ||
          (j !== 1 &&
            (c.state !== 'NOT_READ' ||
              c.rawValue !== null ||
              c.observedTotalCodepoints !== 0))
        )
          fail();
      if (i === 0) {
        const ownMetadata = phase.rowMetadata[i].columns;
        if (
          link.targetRef !== owner.sourceRecordId ||
          row.treeDepth !== 0 ||
          link.numberRaw !== owner.number ||
          ownMetadata[6].rawText?.trim() !== owner.stateRaw.trim() ||
          ownMetadata[8].rawText?.trim() !== owner.sourceModifiedRaw.trim()
        )
          fail('TDMS_COMPLETE_SB_NATIVE_TREE_OWNER_CHANGED');
        ownerSeen++;
      }
    }
    if (ownerSeen !== 1) fail();
    if (!Array.isArray(phase.windowOrdinals) || !phase.windowOrdinals.length)
      fail();
    const seen = new Set();
    let previous = null;
    const pending = phase.rowShapes.filter(
      (s) => shapeState(s).collapsed,
    ).length;
    for (const ordinal of phase.windowOrdinals) {
      const w = table.windows[ordinal];
      if (
        !w ||
        w.ordinal !== ordinal ||
        w.stableReads !== 2 ||
        w.reportedTotal !== phase.reportedTotal ||
        w.treePending !== pending ||
        w.globalIndices?.length !== 0 ||
        w.pageRaw !== null ||
        !same(w.nextControl, {
          present: false,
          enabled: false,
          terminalDeclared: false,
        }) ||
        !keys(w.scroll, ['top', 'height', 'viewport', 'atTop', 'atBottom']) ||
        !['top', 'height', 'viewport'].every(
          (k) => Number.isFinite(w.scroll[k]) && w.scroll[k] >= 0,
        ) ||
        w.scroll.viewport <= 0 ||
        w.scroll.atTop !== w.scroll.top <= 1 ||
        w.scroll.atBottom !==
          w.scroll.top + w.scroll.viewport >= w.scroll.height - 1 ||
        !Array.isArray(w.rowOccurrenceIds) ||
        new Set(w.rowOccurrenceIds).size !== w.rowOccurrenceIds.length ||
        (previous &&
          (w.scroll.top < previous.top ||
            w.scroll.top > previous.top + previous.viewport + 1 ||
            w.scroll.height !== previous.height ||
            w.scroll.viewport !== previous.viewport)) ||
        (!previous && !w.scroll.atTop)
      )
        fail('TDMS_COMPLETE_SB_NATIVE_TREE_WINDOW_UNPROVEN');
      const expected = phase.rows
        .filter((r) => w.rowOccurrenceIds.includes(r.occurrenceId))
        .map((r) => r.occurrenceId);
      if (!same(expected, w.rowOccurrenceIds)) fail();
      for (const id of w.rowOccurrenceIds) seen.add(id);
      previous = w.scroll;
    }
    if (!previous.atBottom || seen.size !== phase.rows.length)
      fail('TDMS_COMPLETE_SB_NATIVE_TREE_VIEWPORT_GAP');
  }
  function expansion(before, after, record) {
    const id = record.occurrenceId,
      bi = before.rows.findIndex((r) => r.occurrenceId === id),
      ai = after.rows.findIndex((r) => r.occurrenceId === id);
    const old = before.rowShapes[bi],
      next = after.rowShapes[ai];
    if (
      bi < 0 ||
      ai < 0 ||
      !shapeState(old).collapsed ||
      !shapeState(next).expanded ||
      shapeState(old).end !== shapeState(next).end ||
      after.rows.length <= before.rows.length
    )
      fail('TDMS_COMPLETE_SB_NATIVE_TREE_NO_PROGRESS');
    const beforeIds = before.rows.map((r) => r.occurrenceId),
      afterIds = after.rows.map((r) => r.occurrenceId);
    if (
      !same(
        afterIds.filter((v) => beforeIds.includes(v)),
        beforeIds,
      )
    )
      fail('TDMS_COMPLETE_RELATION_OVERLAP_CHANGED');
    for (const [i, row] of before.rows.entries()) {
      const j = afterIds.indexOf(row.occurrenceId);
      if (
        rowIdentity(row) !== rowIdentity(after.rows[j]) ||
        rowIdentity(before.rowMetadata[i]) !== rowIdentity(after.rowMetadata[j])
      )
        fail('TDMS_COMPLETE_RELATION_OVERLAP_CHANGED');
      if (
        i !== bi &&
        !same(before.rowShapes[i].elbows, after.rowShapes[j].elbows)
      )
        fail('TDMS_COMPLETE_RELATION_OVERLAP_CHANGED');
    }
    const added = after.rows.filter((r) => !beforeIds.includes(r.occurrenceId));
    const path = before.rows[bi].treePath;
    if (
      !added.length ||
      added.some(
        (row) =>
          row.treeDepth <= before.rows[bi].treeDepth ||
          !same(row.treePath.slice(0, path.length), path),
      )
    )
      fail('TDMS_COMPLETE_SB_NATIVE_TREE_NO_PROGRESS');
    if (
      !keys(record, [
        'occurrenceId',
        'nativeRowId',
        'path',
        'beforeExpanded',
        'afterExpanded',
        'addedOccurrenceIds',
        'controlLocator',
        'beforeShape',
        'afterShape',
        'beforeControl',
        'afterControl',
        'beforeWindowOrdinal',
        'afterWindowOrdinal',
      ]) ||
      record.nativeRowId !== null ||
      record.beforeExpanded !== false ||
      record.afterExpanded !== true ||
      !raw(record.controlLocator, 700) ||
      !same(record.path, path) ||
      !same(
        record.addedOccurrenceIds,
        added.map((r) => r.occurrenceId),
      ) ||
      !same(record.beforeShape, old) ||
      !same(record.afterShape, next) ||
      record.beforeWindowOrdinal !== before.windowOrdinals.at(-1) ||
      record.afterWindowOrdinal !== after.windowOrdinals[0] ||
      !same(record.beforeControl, {
        tag: 'DIV',
        attributes: old.elbows.at(-1),
      }) ||
      !same(record.afterControl, { tag: 'DIV', attributes: next.elbows.at(-1) })
    )
      fail();
    return true;
  }
  function validate({ scopeId, owner, table: t } = {}) {
    const e = t?.nativeTreeEvidence;
    if (e?.modelRevision !== model.modelRevision) {
      if (model.scopeIds.includes(scopeId) && t?.gridId === model.gridId)
        fail('TDMS_COMPLETE_SB_NATIVE_TREE_EVIDENCE_REQUIRED');
      return false;
    }
    if (
      !tableMatches({ scopeId, owner, table: t }) ||
      !keys(e, [
        'modelRevision',
        'scopeMeaning',
        'scopeId',
        'ownerSourceRecordId',
        'ownerSourceVersion',
        'ownerBusinessVersion',
        'ownStateRaw',
        'ownModifiedRaw',
        'rawHeaderIdentifier',
        'columns',
        'rowShapes',
        'rowMetadata',
        'before',
        'after',
        'settledReads',
        'windows',
      ]) ||
      e.scopeMeaning !== model.scopeMeaning ||
      e.scopeId !== scopeId ||
      e.ownerSourceRecordId !== owner.sourceRecordId ||
      !same(e.ownerSourceVersion, owner.sourceVersion) ||
      !same(e.ownerBusinessVersion, owner.businessVersion) ||
      e.ownStateRaw !== owner.stateRaw ||
      e.ownModifiedRaw !== owner.sourceModifiedRaw ||
      e.rawHeaderIdentifier !== owner.rawHeaderIdentifier ||
      e.settledReads !== 2 ||
      !same(e.columns, model.columns) ||
      !same(
        t.rawHeaders,
        model.columns.map((c) => c.actualLabel),
      ) ||
      t.tableTitle !== model.tableTitle ||
      t.scanMode !== 'TREE' ||
      t.relationshipRole !== 'CURRENT_CONTENT' ||
      t.direction !== 'UNKNOWN' ||
      t.ownerSourceRecordId !== owner.sourceRecordId ||
      !same(t.ownerSourceVersion, owner.sourceVersion) ||
      !Array.isArray(e.windows) ||
      !e.windows.length ||
      e.windows.length !== t.treeExpansions?.length + 1 ||
      !same(e.before, e.after)
    )
      fail();
    const used = new Set();
    for (const [i, phase] of e.windows.entries()) {
      if (phase.ordinal !== i) fail();
      validatePhase(phase, t, owner);
      for (const ordinal of phase.windowOrdinals) {
        if (used.has(ordinal)) fail();
        used.add(ordinal);
      }
      if (i) expansion(e.windows[i - 1], phase, t.treeExpansions[i - 1]);
    }
    const last = e.windows.at(-1);
    if (
      used.size !== t.windows.length ||
      !same(last.rows, t.rows) ||
      !same(last.rowShapes, e.rowShapes) ||
      !same(last.rowMetadata, e.rowMetadata) ||
      last.rawCount !== t.countEvidence?.rawText ||
      last.reportedTotal !== t.reportedTotal ||
      !same(e.after, {
        rowOccurrenceIds: t.rows.map((r) => r.occurrenceId),
        query: last.query,
        rawCount: last.rawCount,
        reportedTotal: last.reportedTotal,
        scroll: t.windows.at(-1).scroll,
      })
    )
      fail();
    const closed = e.rowShapes.every((s) => {
      const state = shapeState(s);
      return state.expanded || state.reviewedLeaf;
    });
    const complete = closed;
    if (
      t.terminal?.settledReads !== 2 ||
      t.terminal.total !== t.reportedTotal ||
      t.terminal.captured !== t.rows.length ||
      t.terminal.allGlobalIndices !== false ||
      t.terminal.trueZero !== false
    )
      fail();
    if (complete) {
      if (
        t.enumerationState !== 'VALUE' ||
        t.stopReason !== null ||
        t.countEvidence.exact !== true ||
        t.terminal.kind !== 'NATIVE_END' ||
        t.terminal.nativeTerminal !== true ||
        t.terminal.allTreeNodesExpanded !== true
      )
        fail();
    } else if (
      t.enumerationState !== 'NOT_READ' ||
      t.countEvidence.exact !== false ||
      t.terminal.kind !== 'UNCONFIRMED' ||
      t.terminal.nativeTerminal !== false ||
      t.terminal.allTreeNodesExpanded !== false ||
      !raw(t.stopReason)
    )
      fail();
    return true;
  }
  function readStatus(args = {}) {
    if (!validate(args)) return null;
    const { table } = args,
      e = table.nativeTreeEvidence,
      gaps = [];
    if (e.rowShapes.some((s) => shapeState(s).collapsed))
      gaps.push('TDMS_SB_NATIVE_TREE_COLLAPSED_BRANCH');
    if (
      e.rowShapes.some(
        (s) => shapeState(s).explicitLeaf && !shapeState(s).reviewedLeaf,
      )
    )
      gaps.push('TDMS_SB_NATIVE_TREE_TERMINAL_MARKER_UNREVIEWED');
    const targets = new Set();
    for (const row of table.rows) {
      const id = row.sourceLinks[0].targetRef;
      if (targets.has(id))
        gaps.push('TDMS_SB_NATIVE_TREE_REPEATED_TARGET_OCCURRENCE');
      targets.add(id);
      if (row.treePath.slice(0, -1).includes(id))
        gaps.push('TDMS_SB_NATIVE_TREE_CYCLE_TARGET_EXACT_VERSION_REQUIRED');
    }
    const enumerationComplete = table.enumerationState === 'VALUE';
    if (!metadataComplete(e.rowMetadata))
      gaps.push('TDMS_SB_NATIVE_TREE_ROW_METADATA_UNREAD');
    return {
      enumerationComplete,
      contentComplete: enumerationComplete && metadataComplete(e.rowMetadata),
      queryKnown: true,
      semanticGaps: [...new Set(gaps)],
      reasonCode: gaps[0] ?? null,
    };
  }
  function roles(args = {}) {
    if (!validate(args)) return null;
    return new Map(
      args.table.rows.map((row) => [
        row.occurrenceId,
        {
          relationshipRole:
            row.treeDepth === 0 &&
            row.sourceLinks[0].targetRef === args.owner.sourceRecordId
              ? 'OUT_OF_SCOPE_REFERENCE'
              : 'CURRENT_CONTENT',
          modelRoleOrigin: 'SOURCE_PRESENTED_SB_NATIVE_NUMBER_OCCURRENCE',
          treePath: row.treePath,
        },
      ]),
    );
  }
  function classifyTarget(input = {}) {
    const o = input.parentObservation,
      scopeId = o?.requestedCriteria?.scopeId;
    if (
      !model.scopeIds.includes(scopeId) ||
      (input.parentScopeId !== undefined && input.parentScopeId !== scopeId) ||
      (input.gridId !== undefined && input.gridId !== model.gridId) ||
      o?.reads?.length !== 2
    )
      return null;
    const ownBinding = (read) => {
      const v = read?.owner;
      return (
        v && [
          v.sourceRecordId,
          v.sourceVersion,
          v.businessVersion,
          v.stateRaw,
          v.sourceModifiedRaw,
          v.rawHeaderIdentifier,
        ]
      );
    };
    if (!same(ownBinding(o.reads[0]), ownBinding(o.reads[1]))) return null;
    const occurrence = input.occurrence;
    let result = null;
    for (const read of o.reads) {
      const table = read.relationTables?.find((t) => t.gridId === model.gridId);
      if (!validate({ scopeId, owner: read.owner, table })) return null;
      const row = table.rows.find(
          (r) => r.occurrenceId === occurrence?.occurrenceId,
        ),
        link = row?.sourceLinks[occurrence?.linkIndex];
      if (
        !row ||
        !link ||
        link.targetRef !== occurrence.targetRef ||
        link.rawHref !== occurrence.rawHref ||
        link.locator !== occurrence.locator ||
        !same(row.treePath, occurrence.treePath) ||
        (input.targetRef !== undefined && input.targetRef !== link.targetRef)
      )
        return null;
      const self =
        link.targetRef === read.owner.sourceRecordId && row.treeDepth === 0;
      const metadata = table.nativeTreeEvidence.rowMetadata.find(
        (v) => v.occurrenceId === row.occurrenceId,
      );
      const image = metadata?.columns[0]?.images?.[0];
      const indicator = model.targetIndicators.find(
        (v) =>
          image?.title === v.title &&
          image?.src === v.src &&
          new RegExp(
            '^(?:OR|VR):' +
              v.nativeClass.replaceAll('.', '\\.') +
              ':\\d{1,24}$',
            'u',
          ).test(link.targetRef),
      );
      const value = self
        ? {
            scopeId: null,
            outOfScope: true,
            reasonCode: 'SOURCE_PRESENTED_SB_OWNER_SELF_REFERENCE',
          }
        : indicator
          ? {
              scopeId: indicator.scopeId,
              reasonCode:
                'SOURCE_PRESENTED_SB_TREE_NUMBER_CLASS_AND_NATIVE_TYPE_INDICATOR',
            }
          : null;
      // Unknown indicators remain subject to independent exact directory/own
      // type resolution. A parent row never supplies target opinion/version.
      if (!value || (result && !same(result, value))) return null;
      result = value;
    }
    return result;
  }
  return Object.freeze({
    model,
    stable,
    same,
    hrefTarget,
    ownerMatches,
    tableMatches,
    shapeState,
    bind,
    rowIdentity,
    validateQuery,
    validateMetadata,
    metadataComplete,
    validatePhase,
    expansion,
    validate,
    readStatus,
    roles,
    classifyTarget,
  });
}

const tools = createReviewedSbNativeTreeTools();
export const REVIEWED_SB_NATIVE_TREE_MODEL = tools.model;
export const validateReviewedSbNativeTreeTable = tools.validate;
export const reviewedSbNativeTreeReadStatus = tools.readStatus;
export const reviewedSbNativeTreeOccurrenceRoles = tools.roles;
export const classifyReviewedSbNativeTreeTarget = tools.classifyTarget;
