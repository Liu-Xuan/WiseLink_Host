// Pure consumer selected from complete Source0.2.83 / handoff @13.
import { tdmsError } from './tdms-source.types';
// Exact current native Notebook folder renderer. No action code is read or executed.
export function createReviewedSbNotebookNativeTableTools() {
  const model = Object.freeze({
    schemaVersion: 'wiselink.tdms-sb-notebook-native-leaf-table.v1',
    modelRevision: 'tdms-reviewed-sb-notebook-native-leaf-table@1',
    scopeIds: ['SB', 'SL', 'SIL', 'SB-IN', 'MT'],
    nativeTypeId: 'WCTYPE|wt.doc.WTDocument|com.airchina.SBDocument',
    tabId: 'infoPageinfoPanelID__infoPage_myTab_tab_jcaGen_866988689',
    panelLocator: '#infoPage_myTab_tab_jcaGen_866988689',
    gridId: 'netmarkets.notebookfolder.referenceNotebook',
    purpose: 'CURRENT_NATIVE_NOTEBOOK_FOLDER_LEAF_ROWS',
    stopReason: 'TDMS_COMPLETE_SB_NOTEBOOK_NATIVE_ROWS_UNPROVEN',
    names: ['My General Links', 'My Hot Links'],
    columns: [
      ['', 'checker'],
      ['Name', 'notebookNameId'],
      ['View Information', 'viewInfoAction'],
      ['New Link', 'newLinkAction'],
      ['Edit Link', 'editLinkAction'],
    ].map(([actualLabel, nativeColumnToken]) => ({
      actualLabel,
      nativeColumnToken,
    })),
  });
  const stable = (v) =>
    JSON.stringify(
      (function ordered(x) {
        if (Array.isArray(x)) return x.map(ordered);
        if (x && typeof x === 'object')
          return Object.fromEntries(
            Object.keys(x)
              .sort()
              .map((k) => [k, ordered(x[k])]),
          );
        return x;
      })(v),
    );
  const same = (a, b) => stable(a) === stable(b),
    clone = (v) => JSON.parse(JSON.stringify(v));
  const exact = (v, ks) =>
    v &&
    typeof v === 'object' &&
    !Array.isArray(v) &&
    Object.keys(v).length === ks.length &&
    ks.every((k) => Object.hasOwn(v, k));
  const invalid = (code = 'TDMS_COMPLETE_SB_NOTEBOOK_NATIVE_ROWS_INVALID') => {
    throw tdmsError(code);
  };
  const classes = (v) =>
    typeof v === 'string' ? v.trim().split(/\s+/u).filter(Boolean) : [];
  const expectedRowClasses = (i) => [
    'x-grid3-row',
    'ux-maximgb-tg-level-0',
    ...(i ? ['x-grid3-row-alt', 'x-grid3-row-last'] : ['x-grid3-row-first']),
  ];
  const occurrence = (i) => model.gridId + ':NATIVE_LEAF:' + i;
  function isOwner(scopeId, owner) {
    return (
      model.scopeIds.includes(scopeId) &&
      owner?.scopeEvidence?.businessType === scopeId &&
      owner.nativeTypeId === model.nativeTypeId &&
      owner.nativeTypeEvidence?.state === 'VALUE' &&
      owner.nativeTypeEvidence.rawValue === model.nativeTypeId &&
      owner.rawHeaderType === 'SB文档' &&
      /^(?:OR|VR):wt\.doc\.WTDocument:\d{1,24}$/u.test(
        owner.sourceRecordId || '',
      ) &&
      owner.sourceVersion?.confirmation === 'SOURCE_DECLARED'
    );
  }
  function isTable(scopeId, owner, table) {
    return (
      isOwner(scopeId, owner) &&
      table?.tableId === model.gridId &&
      table.gridId === model.gridId &&
      table.tabId === model.tabId &&
      table.panelLocator === model.panelLocator
    );
  }
  function actionKnown(a) {
    return (
      exact(a, [
        'tag',
        'className',
        'idKind',
        'hrefPresent',
        'hrefProtocol',
        'onclickPresent',
        'qtip',
        'image',
      ]) &&
      a.tag === 'A' &&
      a.className === 'linkfont' &&
      a.idKind === 'P_DIGITS' &&
      a.hrefPresent === true &&
      a.hrefProtocol === 'javascript:' &&
      a.onclickPresent === true &&
      a.qtip === 'New Link' &&
      same(a.image, {
        src: 'netmarkets/images/link_create.gif',
        qtip: 'New Link',
        height: '16',
        width: '16',
        border: '0',
        align: 'middle',
      })
    );
  }
  function metadataKnown(r, i) {
    return (
      exact(r, [
        'position',
        'rowClasses',
        'rowAttributeNames',
        'cellTokens',
        'cellRawTexts',
        'name',
        'nameQtip',
        'nameUnselectable',
        'folderImage',
        'uiWrap',
        'marker',
        'blankRenderers',
        'newLinkAction',
        'businessReferences',
      ]) &&
      r.position === i &&
      same(r.rowClasses, expectedRowClasses(i)) &&
      Array.isArray(r.rowAttributeNames) &&
      same([...r.rowAttributeNames].sort(), ['class', 'style']) &&
      same(
        r.cellTokens,
        model.columns.map((c) => c.nativeColumnToken),
      ) &&
      same(r.cellRawTexts, [
        '\u00a0',
        model.names[i],
        '\u00a0',
        '',
        '\u00a0',
      ]) &&
      r.name === model.names[i] &&
      r.nameQtip === r.name &&
      r.nameUnselectable === 'on' &&
      same(r.folderImage, {
        src: 'wt/clients/images/folder.gif',
        title: null,
      }) &&
      same(r.uiWrap, { className: 'ux-maximgb-tg-uiwrap', width: 16 }) &&
      same(r.marker, {
        className: i ? 'ux-maximgb-tg-elbow-end' : 'ux-maximgb-tg-elbow',
        left: 1,
      }) &&
      same(r.blankRenderers, [
        'CHECKER_DIV_NBSP',
        'EMPTY_INNER_DIV_NBSP',
        'EMPTY_INNER_DIV_NBSP',
      ]) &&
      actionKnown(r.newLinkAction) &&
      Array.isArray(r.businessReferences) &&
      r.businessReferences.length === 0
    );
  }
  const toolbarExpected = [
    {
      tag: 'BUTTON',
      type: 'button',
      className: 'x-btn-text expandCollapse_collapsed',
      text: '',
      image: null,
    },
    {
      tag: 'BUTTON',
      type: 'button',
      className: 'x-btn-text',
      text: 'Actions',
      image: null,
    },
    {
      tag: 'INPUT',
      type: 'text',
      className: 'x-form-text x-form-field invalidDrag x-form-empty-field',
      text: '',
      image: null,
      id: model.gridId + '.fitTextField',
      name: model.gridId + '.fitTextField',
      value: 'Find in tree',
    },
    {
      tag: 'BUTTON',
      type: 'button',
      className: 'x-btn-text',
      text: '',
      image: 'netmarkets/images/downArrow.gif',
    },
    {
      tag: 'BUTTON',
      type: 'button',
      className: 'x-btn-text',
      text: '',
      image: 'netmarkets/images/upArrow.gif',
    },
    {
      tag: 'BUTTON',
      type: 'button',
      className: 'x-btn-text helpButton',
      text: '',
      image: null,
    },
  ].map((v) => ({ ...v, disabled: false, inlineHandlers: [] }));
  function frameKnown(f) {
    if (
      !exact(f, [
        'counts',
        'columns',
        'toolbar',
        'slots',
        'rowMetadata',
        'scroll',
        'loading',
        'blockingMarkers',
        'pagerCount',
      ]) ||
      !same(f.counts, ['( 2 objects )', '( 0 objects selected )']) ||
      !same(f.columns, model.columns) ||
      !same(f.toolbar, toolbarExpected) ||
      f.loading !== false ||
      f.blockingMarkers !== 0 ||
      f.pagerCount !== 0 ||
      !Array.isArray(f.slots) ||
      f.slots.length !== 2 ||
      !Array.isArray(f.rowMetadata) ||
      f.rowMetadata.some(
        (r) => !r || typeof r !== 'object' || Array.isArray(r),
      ) ||
      !exact(f.scroll, ['top', 'height', 'viewport', 'atTop', 'atBottom'])
    )
      return false;
    const s = f.scroll;
    if (
      !['top', 'height', 'viewport'].every(
        (k) => Number.isFinite(s[k]) && s[k] >= 0,
      ) ||
      s.viewport <= 0 ||
      s.height < s.viewport ||
      s.atTop !== s.top <= 1 ||
      s.atBottom !== s.top + s.viewport >= s.height - 1 ||
      s.top > s.height - s.viewport + 1
    )
      return false;
    for (const [i, v] of f.slots.entries())
      if (
        !exact(v, [
          'position',
          'occurrenceId',
          'rowClasses',
          'contentTop',
          'height',
          'cellCount',
        ]) ||
        v.position !== i ||
        v.occurrenceId !== occurrence(i) ||
        !same(v.rowClasses, expectedRowClasses(i)) ||
        !Number.isFinite(v.contentTop) ||
        v.contentTop < 0 ||
        !Number.isFinite(v.height) ||
        v.height <= 0 ||
        v.cellCount !== 5 ||
        v.contentTop + v.height > s.height + 2 ||
        (i === 0 && v.contentTop > 2) ||
        (i > 0 &&
          Math.abs(
            v.contentTop - f.slots[i - 1].contentTop - f.slots[i - 1].height,
          ) > 1)
      )
        return false;
    const expected = f.slots
      .filter(
        (v) =>
          v.contentTop >= s.top - 1 &&
          v.contentTop + v.height <= s.top + s.viewport + 1,
      )
      .map((v) => v.position);
    return (
      same(
        f.rowMetadata.map((r) => r.position),
        expected,
      ) && f.rowMetadata.every((r) => metadataKnown(r, r.position))
    );
  }
  function validateTable(table, { scopeId, owner, read } = {}) {
    const p = table?.relatedSurfaceEvidence;
    if (p?.schemaVersion !== model.schemaVersion) return null;
    if (
      !isTable(scopeId, owner, table) ||
      table.ownerSourceRecordId !== owner.sourceRecordId ||
      !same(table.ownerSourceVersion, owner.sourceVersion) ||
      !exact(p, [
        'schemaVersion',
        'modelRevision',
        'purpose',
        'ownerSourceRecordId',
        'ownerSourceVersion',
        'ownerSourceModifiedRaw',
        'ownerBusinessVersion',
        'ownStateRaw',
        'scopeId',
        'nativeTypeId',
        'sourceContext',
        'normalBinding',
        'tabId',
        'panelLocator',
        'gridId',
        'rows',
        'windows',
      ]) ||
      p.modelRevision !== model.modelRevision ||
      p.purpose !== model.purpose ||
      p.ownerSourceRecordId !== owner.sourceRecordId ||
      !same(p.ownerSourceVersion, owner.sourceVersion) ||
      p.ownerSourceModifiedRaw !== owner.sourceModifiedRaw ||
      !same(p.ownerBusinessVersion, owner.businessVersion) ||
      p.ownStateRaw !== owner.stateRaw ||
      p.scopeId !== scopeId ||
      p.nativeTypeId !== owner.nativeTypeId ||
      !same(p.sourceContext, read?.sourceContext) ||
      !same(p.normalBinding, read?.domDocumentIdentity) ||
      !exact(p.normalBinding, ['url', 'timeOrigin']) ||
      !Number.isFinite(p.normalBinding.timeOrigin) ||
      p.normalBinding.timeOrigin <= 0 ||
      p.tabId !== model.tabId ||
      p.panelLocator !== model.panelLocator ||
      p.gridId !== model.gridId ||
      !Array.isArray(p.rows) ||
      p.rows.length !== 2 ||
      !p.rows.every(metadataKnown) ||
      !Array.isArray(p.windows) ||
      p.windows.length < 2 ||
      p.windows.length > 20
    )
      invalid();
    // Keep the existing Host normal-view binding for this new proof too. The
    // Source helper's outer origin/oid check does not establish an inner route.
    let u, route;
    try {
      u = new URL(p.normalBinding.url);
      route = new URL(u.hash.replace(/^#ptc1/u, ''), u.origin);
      if (
        u.origin !== 'http://tdms.airchina.com' ||
        u.origin !== read.sourceContext?.sourceInstanceOrigin ||
        u.pathname !== '/Windchill/app/' ||
        u.username ||
        u.password ||
        route.origin !== u.origin ||
        route.username ||
        route.password ||
        route.pathname !== '/tcomp/infoPage' ||
        route.searchParams.getAll('oid').length !== 1 ||
        route.searchParams.get('oid') !== owner.sourceRecordId
      )
        invalid();
    } catch {
      invalid();
    }
    const covered = new Set();
    let previous = null;
    for (const [i, w] of p.windows.entries()) {
      if (
        !exact(w, [
          'ordinal',
          'before',
          'after',
          'settledReads',
          'nodeContinuity',
        ]) ||
        w.ordinal !== i ||
        w.settledReads !== 2 ||
        w.nodeContinuity !== 'SAME_NATIVE_BODY_AND_TWO_ROW_NODES' ||
        !same(w.before, w.after) ||
        !frameKnown(w.before)
      )
        invalid();
      const f = w.before,
        s = f.scroll;
      if (
        (!previous && !s.atTop) ||
        (previous &&
          (s.top < previous.scroll.top ||
            s.top > previous.scroll.top + previous.scroll.viewport + 1 ||
            s.height !== previous.scroll.height ||
            s.viewport !== previous.scroll.viewport ||
            !same(f.slots, previous.slots)))
      )
        invalid();
      for (const r of f.rowMetadata) {
        if (!same(r, p.rows[r.position])) invalid();
        covered.add(r.position);
      }
      previous = f;
      const standard = table.windows?.[i];
      if (
        !standard ||
        standard.ordinal !== i ||
        !same(
          standard.rowOccurrenceIds,
          f.rowMetadata.map((r) => occurrence(r.position)),
        ) ||
        standard.globalIndices?.length !== 0 ||
        standard.reportedTotal !== 2 ||
        standard.pageRaw !== null ||
        !same(standard.scroll, s) ||
        !same(standard.nextControl, {
          present: false,
          enabled: false,
          terminalDeclared: false,
        }) ||
        standard.stableReads !== 2 ||
        standard.treePending !== 0
      )
        invalid();
    }
    if (
      covered.size !== 2 ||
      !previous.scroll.atBottom ||
      table.windows.length !== p.windows.length ||
      table.reportedTotal !== 2 ||
      !same(table.countEvidence, {
        rawText: '( 2 objects )',
        exact: true,
        locator:
          model.panelLocator + ' [id="' + model.gridId + '"] span.tableCount',
      }) ||
      !same(
        table.rawHeaders,
        model.columns.map((c) => c.actualLabel),
      ) ||
      table.scanMode !== 'TREE' ||
      table.relationshipRole !== 'CURRENT_CONTENT' ||
      table.direction !== 'UNKNOWN' ||
      table.treeExpansions?.length !== 0 ||
      table.enumerationState !== 'VALUE' ||
      table.stopReason !== null ||
      !same(table.terminal, {
        kind: 'NATIVE_END',
        total: 2,
        captured: 2,
        allGlobalIndices: false,
        allTreeNodesExpanded: true,
        nativeTerminal: true,
        trueZero: false,
        settledReads: 2,
      }) ||
      table.rows?.length !== 2
    )
      invalid();
    for (const [i, r] of table.rows.entries())
      if (
        !r ||
        typeof r !== 'object' ||
        Array.isArray(r) ||
        r.occurrenceId !== occurrence(i) ||
        r.nativeRowId !== null ||
        r.globalIndex !== null ||
        !same(r.treePath, [occurrence(i)]) ||
        r.treeDepth !== 0 ||
        r.nativeRelationId !== null ||
        r.rawRole !== null ||
        r.rawDirection !== null ||
        r.sourceLinks?.length !== 0 ||
        !same(r.observedVersion, {
          rawRevision: null,
          rawIteration: null,
          confirmation: 'VERSION_UNCONFIRMED',
        }) ||
        !same(
          r.cells,
          model.columns.map((c, j) => ({
            actualLabel: c.actualLabel,
            rawValue: j === 1 ? model.names[i] : '',
            state: j === 1 ? 'VALUE' : 'BLANK',
            observedTotalCodepoints: j === 1 ? [...model.names[i]].length : 0,
          })),
        )
      )
        invalid();
    return {
      complete: true,
      enumerationComplete: true,
      contentComplete: true,
      trueZero: false,
      opinionQualification: false,
      reasonCode: null,
    };
  }
  function projectRecord(record) {
    const proof = record?.rawFields?.completeOwnedSource;
    if (!proof) return record;
    // Host computes snapshot identity before full observation validation. These
    // are DTO shape checks, never a fallback or a Source completeness decision.
    if (
      !Array.isArray(proof.reads) ||
      proof.reads.some(
        (r) =>
          !r ||
          typeof r !== 'object' ||
          Array.isArray(r) ||
          !Array.isArray(r.relationTables) ||
          r.relationTables.some(
            (t) => !t || typeof t !== 'object' || Array.isArray(t),
          ),
      )
    )
      throw tdmsError('TDMS_COMPLETE_OWN_FIELDS_INVALID');
    if (
      !proof.reads.some((r) =>
        r.relationTables.some(
          (t) =>
            t.relatedSurfaceEvidence?.schemaVersion === model.schemaVersion,
        ),
      )
    )
      return record;
    const copy = clone(record);
    for (const read of copy.rawFields.completeOwnedSource.reads)
      for (const table of read.relationTables || [])
        if (
          table.relatedSurfaceEvidence?.schemaVersion === model.schemaVersion
        ) {
          validateTable(table, {
            scopeId: read.owner?.scopeEvidence?.businessType,
            owner: read.owner,
            read,
          });
          table.relatedSurfaceEvidence.normalBinding.timeOrigin =
            '@validated-sb-notebook-time-origin';
        }
    return copy;
  }
  function readAction(anchor) {
    if (
      !anchor ||
      anchor.tagName !== 'A' ||
      anchor.children.length !== 1 ||
      anchor.firstElementChild.tagName !== 'IMG' ||
      !/^P\d{1,24}$/u.test(anchor.id) ||
      !same(anchor.getAttributeNames().sort(), [
        'class',
        'ext:qtip',
        'href',
        'id',
        'onclick',
      ])
    )
      invalid();
    const img = anchor.firstElementChild;
    if (
      !same(img.getAttributeNames().sort(), [
        'align',
        'border',
        'ext:qtip',
        'height',
        'src',
        'width',
      ])
    )
      invalid();
    const a = {
      tag: 'A',
      className: anchor.getAttribute('class'),
      idKind: 'P_DIGITS',
      hrefPresent: anchor.hasAttribute('href'),
      hrefProtocol: anchor.protocol,
      onclickPresent: anchor.hasAttribute('onclick'),
      qtip: anchor.getAttribute('ext:qtip'),
      image: Object.fromEntries(
        ['src', 'height', 'width', 'border', 'align'].map((k) => [
          k,
          img.getAttribute(k),
        ]),
      ),
    };
    a.image.qtip = img.getAttribute('ext:qtip');
    if (!actionKnown(a)) invalid();
    return a;
  }
  // The native cell focus order is presentation metadata, constrained per column.
  // Keep both observed DOM shapes; no handler, link or business value is ignored.
  function cellAttributesKnown(cell, columnToken) {
    const names = cell.getAttributeNames().sort();
    return (
      model.columns.some((c) => c.nativeColumnToken === columnToken) &&
      (same(names, ['class', 'style']) ||
        (same(names, ['class', 'style', 'tabindex']) &&
          cell.getAttribute('tabindex') ===
            (columnToken === 'notebookNameId' ? '0' : '-1')))
    );
  }
  function actionAnchor(anchor, input) {
    try {
      const cell = anchor.closest('td.x-grid3-cell'),
        g = cell?.closest('.x-grid-panel'),
        inner = cell?.firstElementChild;
      return (
        model.scopeIds.includes(input?.scopeId) &&
        g?.id === model.gridId &&
        g.closest(model.panelLocator) &&
        cell.tagName === 'TD' &&
        cellAttributesKnown(cell, 'newLinkAction') &&
        cell.classList.contains('x-grid3-td-newLinkAction') &&
        cell.children.length === 1 &&
        inner?.tagName === 'DIV' &&
        inner.className === 'x-grid3-cell-inner x-grid3-col-newLinkAction' &&
        same(inner.getAttributeNames(), ['class']) &&
        inner.children.length === 1 &&
        inner.firstElementChild === anchor &&
        cell.textContent === '' &&
        !!readAction(anchor)
      );
    } catch {
      return false;
    }
  }
  async function capture({ grid, tab, input, owner, read, context, env }) {
    if (
      !isOwner(input.scopeId, owner) ||
      grid.id !== model.gridId ||
      tab.tabId !== model.tabId ||
      tab.panelLocator !== model.panelLocator
    )
      return null;
    const nodes = (n, s) => Array.from(n.querySelectorAll(s)),
      body = nodes(grid, '.x-grid3-body').filter(
        (n) => n.closest('.x-grid-panel') === grid,
      ),
      scrollers = nodes(grid, '.x-grid3-scroller').filter(
        (n) => n.closest('.x-grid-panel') === grid,
      );
    if (
      body.length !== 1 ||
      scrollers.length !== 1 ||
      body[0].children.length !== 2
    )
      return null;
    const bodyNode = body[0],
      rowNodes = Array.from(bodyNode.children),
      scroller = scrollers[0];
    const guard = () => {
      env.guard();
      if (
        context.document !== grid.ownerDocument ||
        context.timeOrigin !==
          grid.ownerDocument.defaultView.performance.timeOrigin ||
        grid.ownerDocument.defaultView.location.href !==
          read.domDocumentIdentity.url ||
        !env.visible(grid) ||
        !env.owned(grid) ||
        !grid.isConnected ||
        !bodyNode.isConnected ||
        bodyNode.parentElement.closest('.x-grid-panel') !== grid ||
        !same(
          Array.from(bodyNode.children).map((n) => rowNodes.indexOf(n)),
          [0, 1],
        )
      )
        invalid('TDMS_COMPLETE_SB_NOTEBOOK_NATIVE_CONTEXT_CHANGED');
    };
    const safe = (n) => {
      if (
        [n, ...nodes(n, '*')].some(
          (x) =>
            !env.visible(x) ||
            !env.owned(x) ||
            (x.getAttributeNames().some((k) => /^on/iu.test(k)) &&
              !(x.tagName === 'A' && actionAnchor(x, input))),
        ) ||
        nodes(
          n,
          'input,select,textarea,iframe,object,embed,canvas,video,audio,[contenteditable]',
        ).length
      )
        invalid();
    };
    const attrs = (n, expected) => {
      if (!same(n.getAttributeNames().sort(), expected.slice().sort()))
        invalid();
    };
    const allCells = (row) =>
      nodes(row, 'td.x-grid3-cell').filter(
        (c) =>
          c.closest('.x-grid3-row') === row &&
          c.closest('.x-grid-panel') === grid,
      );
    function metadata(row, i) {
      safe(row);
      attrs(row, ['class', 'style']);
      const cells = allCells(row);
      if (cells.length !== 5) invalid();
      for (const [j, c] of cells.entries()) {
        safe(c);
        if (!cellAttributesKnown(c, model.columns[j].nativeColumnToken))
          invalid();
        if (
          classes(c.className)
            .filter((v) => v.startsWith('x-grid3-td-'))
            .join('') !==
          'x-grid3-td-' + model.columns[j].nativeColumnToken
        )
          invalid();
      }
      const inner = (j) => {
        const n = cells[j].children;
        if (
          n.length !== 1 ||
          n[0].tagName !== 'DIV' ||
          classes(n[0].className).join(' ') !==
            'x-grid3-cell-inner x-grid3-col-' +
              model.columns[j].nativeColumnToken
        )
          invalid();
        attrs(n[0], ['class']);
        return n[0];
      };
      const checker = inner(0);
      if (
        checker.children.length !== 1 ||
        checker.firstElementChild.tagName !== 'DIV' ||
        checker.firstElementChild.className !== 'x-grid3-row-checker' ||
        checker.firstElementChild.children.length
      )
        invalid();
      attrs(checker.firstElementChild, ['class']);
      for (const j of [2, 4]) if (inner(j).children.length) invalid();
      const newInner = inner(3);
      if (newInner.children.length !== 1) invalid();
      const action = readAction(newInner.firstElementChild);
      const nameCell = cells[1],
        master = nameCell.children[0];
      if (
        nameCell.children.length !== 1 ||
        master?.className !== 'ux-maximgb-tg-mastercell-wrap' ||
        master.children.length !== 2
      )
        invalid();
      attrs(master, ['class']);
      const ui = master.children[0],
        name = master.children[1];
      if (
        ui.className !== 'ux-maximgb-tg-uiwrap' ||
        ui.children.length !== 1 ||
        name.tagName !== 'DIV' ||
        classes(name.className).join(' ') !==
          'x-grid3-cell-inner x-grid3-col-notebookNameId' ||
        name.children.length !== 1 ||
        name.firstElementChild.tagName !== 'IMG'
      )
        invalid();
      attrs(ui, ['class', 'style']);
      attrs(name, ['class', 'unselectable', 'ext:qtip']);
      const marker = ui.firstElementChild;
      attrs(marker, ['class', 'style']);
      if (marker.tagName !== 'DIV' || marker.children.length) invalid();
      const folder = name.firstElementChild;
      attrs(folder, ['src']);
      const refs = cells
        .filter((_, j) => j !== 3)
        .flatMap((c) => nodes(c, 'a[href]'));
      if (refs.length) invalid();
      const m = {
        position: i,
        rowClasses: classes(row.className),
        rowAttributeNames: row.getAttributeNames().sort(),
        cellTokens: cells.map((c) =>
          classes(c.className)
            .find((v) => v.startsWith('x-grid3-td-'))
            .slice(11),
        ),
        cellRawTexts: cells.map((c, j) =>
          j === 1 ? name.textContent : c.textContent,
        ),
        name: name.textContent,
        nameQtip: name.getAttribute('ext:qtip'),
        nameUnselectable: name.getAttribute('unselectable'),
        folderImage: {
          src: folder.getAttribute('src'),
          title: folder.getAttribute('title'),
        },
        uiWrap: {
          className: ui.className,
          width: Number.parseFloat(ui.style.width),
        },
        marker: {
          className: marker.className,
          left: Number.parseFloat(marker.style.left),
        },
        blankRenderers: [
          'CHECKER_DIV_NBSP',
          'EMPTY_INNER_DIV_NBSP',
          'EMPTY_INNER_DIV_NBSP',
        ],
        newLinkAction: action,
        businessReferences: [],
      };
      if (!metadataKnown(m, i)) invalid();
      return m;
    }
    function frame() {
      guard();
      const columns = nodes(grid, '.x-grid3-header td.x-grid3-hd').map((n) => ({
        actualLabel: (n.textContent || '').trim(),
        nativeColumnToken:
          classes(n.className)
            .find((c) => c.startsWith('x-grid3-td-'))
            ?.slice(11) || null,
      }));
      const controls = nodes(
        grid,
        'button,input,select,textarea,[contenteditable]',
      ).filter((n) => env.visible(n) && !n.closest('.x-grid3-row'));
      const toolbar = controls.map((n) => {
        if (!env.owned(n)) invalid();
        const inlineHandlers = n
            .getAttributeNames()
            .filter((k) => /^on/iu.test(k)),
          style = n.style.backgroundImage;
        let image = null;
        if (style) {
          const m = style.match(
            /^url\(["']?(netmarkets\/images\/(?:downArrow|upArrow)\.gif)["']?\)$/u,
          );
          if (!m) invalid();
          image = m[1];
        }
        return {
          tag: n.tagName,
          type: n.type,
          className: classes(n.className).join(' '),
          text: n.tagName === 'BUTTON' ? n.textContent : '',
          image,
          ...(n.tagName === 'INPUT'
            ? { id: n.id, name: n.getAttribute('name'), value: n.value }
            : {}),
          disabled: n.disabled,
          inlineHandlers,
        };
      });
      const view = scroller.getBoundingClientRect(),
        scroll = {
          top: Number(scroller.scrollTop),
          height: Number(scroller.scrollHeight),
          viewport: Number(scroller.clientHeight),
          atTop: scroller.scrollTop <= 1,
          atBottom:
            scroller.scrollTop + scroller.clientHeight >=
            scroller.scrollHeight - 1,
        };
      const slots = rowNodes.map((row, i) => {
        safe(row);
        attrs(row, ['class', 'style']);
        const rect = row.getBoundingClientRect();
        return {
          position: i,
          occurrenceId: occurrence(i),
          rowClasses: classes(row.className),
          contentTop: Number((rect.top - view.top + scroll.top).toFixed(3)),
          height: Number(rect.height.toFixed(3)),
          cellCount: allCells(row).length,
        };
      });
      const result = {
        counts: nodes(grid, 'span.tableCount')
          .filter(env.visible)
          .map((n) => (n.textContent || '').trim()),
        columns,
        toolbar,
        slots,
        rowMetadata: slots
          .filter(
            (s) =>
              s.contentTop >= scroll.top - 1 &&
              s.contentTop + s.height <= scroll.top + scroll.viewport + 1,
          )
          .map((s) => metadata(rowNodes[s.position], s.position)),
        scroll,
        loading: env.loading(grid),
        blockingMarkers: nodes(
          grid,
          '.permission-denied,.access-denied,.error-message,.x-error,[role="alert"],[aria-invalid="true"],[data-permission-denied],[data-error]',
        ).filter(env.visible).length,
        pagerCount: nodes(
          grid,
          '.x-tbar-page-next,.x-tbar-page-first,input.x-tbar-page-number',
        ).filter(env.visible).length,
      };
      if (!frameKnown(result)) invalid();
      guard();
      return result;
    }
    try {
      guard();
      scroller.scrollTop = 0;
      scroller.dispatchEvent(
        new grid.ownerDocument.defaultView.Event('scroll', { bubbles: true }),
      );
      const proofWindows = [],
        windows = [],
        found = new Map();
      let prior = null;
      for (let i = 0; i < 20; i++) {
        const before = frame();
        await env.pause();
        const after = frame();
        if (!same(before, after))
          invalid('TDMS_COMPLETE_SB_NOTEBOOK_NATIVE_ROWS_CHANGED');
        if (
          prior &&
          (!same(prior.slots, before.slots) ||
            before.scroll.top > prior.scroll.top + prior.scroll.viewport + 1 ||
            before.scroll.top <= prior.scroll.top)
        )
          invalid();
        for (const r of before.rowMetadata) {
          if (found.has(r.position) && !same(found.get(r.position), r))
            invalid('TDMS_COMPLETE_SB_NOTEBOOK_NATIVE_ROWS_CHANGED');
          found.set(r.position, r);
        }
        proofWindows.push({
          ordinal: i,
          before,
          after,
          settledReads: 2,
          nodeContinuity: 'SAME_NATIVE_BODY_AND_TWO_ROW_NODES',
        });
        windows.push({
          ordinal: i,
          rowOccurrenceIds: before.rowMetadata.map((r) =>
            occurrence(r.position),
          ),
          globalIndices: [],
          reportedTotal: 2,
          pageRaw: null,
          scroll: before.scroll,
          nextControl: {
            present: false,
            enabled: false,
            terminalDeclared: false,
          },
          stableReads: 2,
          treePending: 0,
          observedAt: env.now(),
        });
        if (before.scroll.atBottom) break;
        prior = before;
        const top = Math.min(
          before.scroll.height - before.scroll.viewport,
          before.scroll.top +
            Math.max(1, Math.floor(before.scroll.viewport * 0.75)),
        );
        guard();
        scroller.scrollTop = top;
        scroller.dispatchEvent(
          new grid.ownerDocument.defaultView.Event('scroll', { bubbles: true }),
        );
      }
      if (found.size !== 2 || !windows.at(-1)?.scroll.atBottom) invalid();
      const rows = [found.get(0), found.get(1)];
      const table = {
        tableId: model.gridId,
        tabId: model.tabId,
        tableTitle: model.gridId,
        panelLocator: model.panelLocator,
        gridId: model.gridId,
        relationshipRole: 'CURRENT_CONTENT',
        direction: 'UNKNOWN',
        rawHeaders: model.columns.map((c) => c.actualLabel),
        reportedTotal: 2,
        countEvidence: {
          rawText: '( 2 objects )',
          exact: true,
          locator:
            model.panelLocator + ' [id="' + model.gridId + '"] span.tableCount',
        },
        scanMode: 'TREE',
        rows: rows.map((r, i) => ({
          occurrenceId: occurrence(i),
          globalIndex: null,
          nativeRowId: null,
          treePath: [occurrence(i)],
          treeDepth: 0,
          nativeRelationId: null,
          rawRole: null,
          rawDirection: null,
          cells: model.columns.map((c, j) => ({
            actualLabel: c.actualLabel,
            rawValue: j === 1 ? r.name : '',
            state: j === 1 ? 'VALUE' : 'BLANK',
            observedTotalCodepoints: j === 1 ? [...r.name].length : 0,
          })),
          sourceLinks: [],
          observedVersion: {
            rawRevision: null,
            rawIteration: null,
            confirmation: 'VERSION_UNCONFIRMED',
          },
        })),
        windows,
        treeExpansions: [],
        terminal: {
          kind: 'NATIVE_END',
          total: 2,
          captured: 2,
          allGlobalIndices: false,
          allTreeNodesExpanded: true,
          nativeTerminal: true,
          trueZero: false,
          settledReads: 2,
        },
        enumerationState: 'VALUE',
        stopReason: null,
        ownerSourceRecordId: owner.sourceRecordId,
        ownerSourceVersion: clone(owner.sourceVersion),
        observedAt: env.now(),
        relatedSurfaceEvidence: {
          schemaVersion: model.schemaVersion,
          modelRevision: model.modelRevision,
          purpose: model.purpose,
          ownerSourceRecordId: owner.sourceRecordId,
          ownerSourceVersion: clone(owner.sourceVersion),
          ownerSourceModifiedRaw: owner.sourceModifiedRaw,
          ownerBusinessVersion: clone(owner.businessVersion),
          ownStateRaw: owner.stateRaw,
          scopeId: input.scopeId,
          nativeTypeId: owner.nativeTypeId,
          sourceContext: clone(read.sourceContext),
          normalBinding: clone(read.domDocumentIdentity),
          tabId: model.tabId,
          panelLocator: model.panelLocator,
          gridId: model.gridId,
          rows,
          windows: proofWindows,
        },
      };
      validateTable(table, { scopeId: input.scopeId, owner, read });
      return table;
    } catch (error) {
      if (
        error.code &&
        error.code !== 'TDMS_COMPLETE_SB_NOTEBOOK_NATIVE_ROWS_INVALID'
      )
        throw error;
      return null;
    }
  }
  return {
    model,
    stable,
    same,
    isOwner,
    isTable,
    actionKnown,
    metadataKnown,
    frameKnown,
    validateTable,
    projectRecord,
    readAction,
    actionAnchor,
    capture,
  };
}
export const SB_NOTEBOOK_NATIVE_TABLE =
  createReviewedSbNotebookNativeTableTools();
