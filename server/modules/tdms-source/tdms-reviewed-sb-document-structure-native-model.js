// Pure SB consumer model selectively vendored from Source 0.2.73 / handoff @8.
import { tdmsError } from './tdms-source.types';
import {
  reviewedEfUsesQueryControlsKnown as gwtQueryControlsKnown,
  reviewedEfUsesQuerySnapshotMetadataKnown as gwtQuerySnapshotMetadataKnown,
} from './tdms-reviewed-efrequest-structure-native-model';

// Independent SB-family binding. The GWT component's metadata renderer is
// shared by TDMS document types; EFRequest qualification and scope are not.
export const REVIEWED_SB_DOCUMENT_STRUCTURE_MODEL = Object.freeze({
  schemaVersion: 'wiselink.tdms-sb-document-structure-native.v1',
  modelRevision: 'tdms-reviewed-sb-document-structure-native@1',
  scopeIds: ['SB', 'SIL', 'SB-IN', 'SL', 'MT'],
  nativeTypeId: 'WCTYPE|wt.doc.WTDocument|com.airchina.SBDocument',
  nativeHeaderType: 'SB文档',
  tabId: 'infoPageinfoPanelID__infoPage_myTab_docsb_docStructureGWT',
  panelLocator: '#infoPage_myTab_docsb_docStructureGWT',
  label: 'Structure',
  frameId: 'docsbIFrame',
  framePath: '/Windchill/netmarkets/jsp/docsb/docsb-iframe.jsp',
  componentId: 'catGSEViewMainPanel',
  innerTitle: 'Windchill PDMLink',
  purpose: 'REQUIRED_NATIVE_DOCUMENT_STRUCTURE_RELATIONS',
  tableId: 'docsb.DOCSB.uses',
  tableTitle: 'Uses',
  detailTabId:
    'infoPageinfoPanelID__infoPage_myTab_object_docInfoDefaultDetails',
  detailPanelLocator: '#infoPage_myTab_object_docInfoDefaultDetails',
  stopReason: 'TDMS_COMPLETE_SB_STRUCTURE_END_UNPROVEN',
  nativeEmptyText: 'No data to display',
  findPlaceholder: 'Find in Structure',
  usesSearchPlaceholder: 'Search in Uses',
  inputSha256:
    'c40c488ed7ba7c3e052ce7fa2bbc65f9a513f8223f993010cc96403f4a6480c0',
  treeColumn: {
    actualLabel: 'Identity',
    nativeColumnToken: 'Child:identityBuilder',
  },
  usesColumns: [
    { actualLabel: '', nativeColumnToken: 'tableIcon', read: false },
    { actualLabel: 'Number', nativeColumnToken: 'Master:number', read: true },
    { actualLabel: 'Name', nativeColumnToken: 'Master:name', read: true },
    { actualLabel: '', nativeColumnToken: 'Child:checkOutStatus', read: false },
    {
      actualLabel: '',
      nativeColumnToken: 'Child:statusFamily_Share',
      read: false,
    },
    { actualLabel: '', nativeColumnToken: 'Child:noteStat', read: false },
    { actualLabel: 'Version', nativeColumnToken: 'Child:version', read: true },
    {
      actualLabel: 'Description',
      nativeColumnToken: 'Child:description',
      read: false,
    },
    {
      actualLabel: 'State',
      nativeColumnToken: 'Child:lifeCycleState',
      read: true,
    },
  ],
  attributeLabels: [
    'Number:',
    'Name:',
    'Version:',
    'Type:',
    'Primary Content:',
    'Latest Iteration:',
    'State:',
    'Status:',
    'Modified By:',
    'Last Modified:',
  ],
  configuration: {
    typeRaw: 'Latest',
    detailsRaw: 'Working',
    applyToTopLevelObjectChecked: true,
    applyLatestForUnresolvedDependentsChecked: false,
  },
  checkboxLabels: [
    'Apply to top level object',
    'Apply latest for unresolved dependents',
  ],
});

// This factory is deliberately self-contained for the existing classic content
// script. Inline the exact factory and model; never substitute an EF scope.
export function createReviewedSbDocumentStructureAdapter(M, sharedGwt) {
  const exact = (v, ks) =>
    !!v &&
    typeof v === 'object' &&
    !Array.isArray(v) &&
    Object.keys(v).length === ks.length &&
    ks.every((k) => Object.hasOwn(v, k));
  const stable = (v) =>
    JSON.stringify(
      (function ordered(x) {
        return Array.isArray(x)
          ? x.map(ordered)
          : x && typeof x === 'object'
            ? Object.fromEntries(
                Object.keys(x)
                  .sort()
                  .map((k) => [k, ordered(x[k])]),
              )
            : x;
      })(v),
    );
  const clone = (v) => JSON.parse(JSON.stringify(v));
  const classes = (n) =>
    (typeof n === 'string' ? n : n?.getAttribute('class') || '')
      .trim()
      .split(/\s+/u)
      .filter(Boolean);
  const has = (n, c) => classes(n).includes(c);
  const invalid = () => {
    throw tdmsError('TDMS_COMPLETE_SB_STRUCTURE_NATIVE_INVALID');
  };
  const nodes = (root, selector) => [...root.querySelectorAll(selector)];
  const one = (root, selector) => {
    const found = nodes(root, selector);
    if (found.length !== 1) invalid();
    return found[0];
  };
  const visible = (n) => {
    if (!n?.ownerDocument?.defaultView || !n.getClientRects().length)
      return false;
    for (let e = n; e; e = e.parentElement) {
      const s = e.ownerDocument.defaultView.getComputedStyle(e);
      if (
        s.display === 'none' ||
        s.visibility === 'hidden' ||
        s.opacity === '0' ||
        e.hidden ||
        e.getAttribute('aria-hidden') === 'true'
      )
        return false;
    }
    return true;
  };
  const node = (n) => ({
    tag: n.tagName,
    id: n.getAttribute('id'),
    rawClassName: n.getAttribute('class') || '',
    visible: visible(n),
  });
  const text = (n, max = 10000) => {
    const value = n.textContent;
    if (typeof value !== 'string' || value.length > max) invalid();
    return value;
  };
  const marker = (name) =>
    /^(?:data-(?:filter|view|query|search|selected-only)(?:-|$)|contenteditable$|on)/u.test(
      name,
    );
  const valueSafe = (n) => {
    for (let p = n; p; p = p.parentElement) {
      if (p.getAttributeNames().some(marker)) invalid();
    }
  };
  const rawControl = (n) => ({
    node: node(n),
    attributeNames: n.getAttributeNames().sort(),
    typeRaw: n.getAttribute('type'),
    nameRaw: n.getAttribute('name'),
    roleRaw: n.getAttribute('role'),
    ariaPressed: n.getAttribute('aria-pressed'),
    ariaExpanded: n.getAttribute('aria-expanded'),
    ariaChecked: n.getAttribute('aria-checked'),
    disabled: !!n.disabled,
    placeholderRaw: n.getAttribute('placeholder'),
  });
  const currentOwner = (scopeId, owner) =>
    M.scopeIds.includes(scopeId) &&
    /^(?:OR|VR):wt\.doc\.WTDocument:\d{1,24}$/u.test(
      owner?.sourceRecordId || '',
    ) &&
    owner.nativeTypeId === M.nativeTypeId &&
    owner.rawHeaderType === M.nativeHeaderType &&
    owner.scopeEvidence?.businessType === scopeId &&
    owner.sourceVersion?.confirmation === 'SOURCE_DECLARED' &&
    owner.nativeTypeEvidence?.state === 'VALUE' &&
    owner.nativeTypeEvidence.rawValue === M.nativeTypeId;
  const isTab = ({ scopeId, owner, tab } = {}) =>
    currentOwner(scopeId, owner) && tab?.tabId === M.tabId;
  const urlKnown = (raw, origin, owner) => {
    let u;
    try {
      u = new URL(raw, origin + '/Windchill/');
    } catch {
      invalid();
    }
    if (
      u.origin !== origin ||
      u.pathname !== M.framePath ||
      u.hash ||
      u.username ||
      u.password ||
      stable([...u.searchParams.keys()]) !==
        stable(['oid', 'u8', 'AjaxEnabled']) ||
      u.searchParams.get('oid') !== owner.sourceRecordId ||
      u.searchParams.get('u8') !== '1' ||
      u.searchParams.get('AjaxEnabled') !== 'thirdLevelNav'
    )
      invalid();
    return u.href;
  };
  const context = (surface, tab, input, owner, normalContext) => {
    if (
      !currentOwner(input.scopeId, owner) ||
      input.sourceObjectRef !== owner.sourceRecordId ||
      tab.tabId !== M.tabId ||
      tab.label !== M.label ||
      tab.panelLocator !== M.panelLocator ||
      surface.id !== M.panelLocator.slice(1) ||
      !visible(surface) ||
      !has(tab.node, 'x-tab-strip-active')
    )
      invalid();
    const top = surface.ownerDocument,
      win = top.defaultView;
    if (
      top !== normalContext.document ||
      win.performance.timeOrigin !== normalContext.timeOrigin ||
      normalContext.url !== win.location.href ||
      Date.now() >= input.executionDeadlineMs
    )
      invalid();
    const route = new URL(win.location.href),
      hash = route.hash.replace(/^#ptc1/u, '');
    let routed;
    try {
      routed = new URL(hash, route.origin);
    } catch {
      invalid();
    }
    if (
      route.pathname !== '/Windchill/app/' ||
      routed.pathname !== '/tcomp/infoPage' ||
      routed.searchParams.getAll('oid').length !== 1 ||
      routed.searchParams.get('oid') !== owner.sourceRecordId
    )
      invalid();
    const frame = one(surface, 'iframe');
    if (frame.id !== M.frameId || !visible(frame)) invalid();
    const rawSrc = frame.getAttribute('src'),
      canonical = urlKnown(rawSrc, win.location.origin, owner);
    let inner;
    try {
      inner = frame.contentDocument;
    } catch {
      return null;
    }
    if (!inner || inner.readyState !== 'complete') return null;
    if (
      urlKnown(inner.URL, win.location.origin, owner) !== canonical ||
      inner.title !== M.innerTitle
    )
      invalid();
    const roots = nodes(inner, '[id="' + M.componentId + '"]');
    if (roots.length !== 1 || !visible(roots[0])) return null;
    const component = roots[0];
    if (nodes(inner, 'form input[type="password"]').length) invalid();
    return { top, win, frame, rawSrc, inner, component };
  };
  const innerTab = (component, suffix, label) => {
    const found = one(component, 'li[role="tab"][id$="' + suffix + '"]');
    valueSafe(found);
    if (text(found, 100) !== label || !visible(found)) invalid();
    const action = one(found, 'a.x-tab-right');
    return {
      element: found,
      action,
      proof: {
        node: node(found),
        suffix,
        label,
        active: has(found, 'x-tab-strip-active'),
      },
    };
  };
  const header = (grid, columns) => {
    const cells = nodes(
      grid,
      '.x-grid3-header td.x-grid3-cell,.x-grid3-hd-row td.x-grid3-cell',
    ).filter(
      (n) =>
        n.closest('.x-grid-panel') === grid &&
        !n.closest('.x-grid3-row,.x-grid3-body'),
    );
    if (cells.length !== columns.length) invalid();
    // Full metadata admission precedes every header caption getter. No arbitrary
    // data query markers, form controls or per-column filter values are read.
    for (const cell of cells)
      for (const n of [cell, ...nodes(cell, '*')]) {
        if (
          n.getAttributeNames().some(marker) ||
          n.matches('input,select,textarea,button')
        )
          invalid();
        for (const name of n
          .getAttributeNames()
          .filter((k) => k.startsWith('aria-')))
          if (!['aria-haspopup', 'aria-owns', 'aria-sort'].includes(name))
            invalid();
      }
    return cells.map((cell, i) => {
      const spec = columns[i],
        tokens = classes(cell).filter((k) => k.startsWith('x-grid3-td-'));
      if (
        tokens.length !== 1 ||
        tokens[0] !== 'x-grid3-td-' + spec.nativeColumnToken
      )
        invalid();
      const rawCaptionText = text(cell, 200);
      if (rawCaptionText.trim() !== spec.actualLabel) invalid();
      return {
        node: node(cell),
        nativeColumnToken: spec.nativeColumnToken,
        actualLabel: spec.actualLabel,
        rawCaptionText,
      };
    });
  };
  const attributes = (component) => {
    const panels = nodes(component, 'fieldset.x-fieldset').filter((p) =>
      nodes(p, '.x-fieldset-header-text').some(
        (n) => text(n, 100) === 'Document Attributes',
      ),
    );
    if (panels.length !== 1) invalid();
    const panel = panels[0],
      labels = nodes(panel, 'label.attributePanel-label');
    if (labels.length !== M.attributeLabels.length) invalid();
    const slots = labels.map((label, i) => {
      valueSafe(label);
      const rawLabel = text(label, 100),
        cell = label.closest('td'),
        value = cell?.nextElementSibling;
      if (
        rawLabel.trim() !== M.attributeLabels[i] ||
        !has(cell, 'x-table-layout-cell') ||
        value?.tagName !== 'TD' ||
        !has(value, 'x-table-layout-cell') ||
        value.children.length !== 1 ||
        !has(value.children[0], 'x-form-group')
      )
        invalid();
      return { label, value, rawLabel };
    });
    return {
      panel: node(panel),
      fields: slots.map(({ value, rawLabel }) => {
        // State here is a template. It never qualifies an assessment or target.
        if (rawLabel.trim() === 'Modified By:')
          return { label: rawLabel, state: 'NOT_READ', rawValue: null };
        valueSafe(value);
        const rawValue = text(value);
        return {
          label: rawLabel,
          state: rawValue.trim() ? 'VALUE' : 'BLANK',
          rawValue,
        };
      }),
    };
  };
  const rootTree = (grid, owner) => {
    const nativeHeaders = header(grid, [M.treeColumn]),
      rows = nodes(grid, '.x-grid3-row').filter(
        (n) => n.closest('.x-grid-panel') === grid,
      );
    if (rows.length > 1000) invalid();
    const values = rows.map((row) => {
      const identities = nodes(row, '.x-tree3-node-text');
      if (identities.length !== 1) invalid();
      valueSafe(identities[0]);
      const rawIdentity = text(identities[0], 1000),
        own = rawIdentity === owner.rawHeaderIdentifier;
      const rawInformationIds = nodes(row, '[id^="miniInfo_"]').map(
        (n) => n.id,
      );
      return {
        node: node(row),
        rawIdentity,
        selected: has(row, 'x-grid3-row-selected'),
        ownIdentity: own,
        rawInformationIds,
        ariaLevel: row.getAttribute('aria-level'),
        ariaExpanded: row.getAttribute('aria-expanded'),
        disclosure: nodes(row, '.x-tree3-el img').map((image) => ({
          node: node(image),
          rawSrc: image.getAttribute('src'),
          rawStyle: image.getAttribute('style'),
          rawTitle: image.getAttribute('title'),
          rawAlt: image.getAttribute('alt'),
        })),
        leafSemantics: 'UNCONFIRMED',
      };
    });
    const scrollers = nodes(grid, '.x-grid3-scroller').filter(
      (n) => n.closest('.x-grid-panel') === grid,
    );
    if (scrollers.length !== 1) invalid();
    const s = scrollers[0];
    return {
      node: node(grid),
      nativeHeaders,
      rows: values,
      scroll: {
        top: s.scrollTop,
        height: s.scrollHeight,
        viewport: s.clientHeight,
      },
      counts: nodes(grid, '.tableCount').map((n) => ({
        node: node(n),
        rawText: text(n, 200),
      })),
      pagers: nodes(
        grid,
        '.x-tbar-page-number,.x-tbar-page-next,.x-paging-info',
      ).map(node),
    };
  };
  const usesRows = (grid) =>
    nodes(grid, '.x-grid3-row')
      .filter((n) => n.closest('.x-grid-panel') === grid)
      .map((row) => {
        const cells = nodes(row, 'td.x-grid3-cell').filter(
          (n) => n.closest('.x-grid3-row') === row,
        );
        if (cells.length !== M.usesColumns.length || !visible(row)) invalid();
        const rawReferences = [];
        const values = cells.map((cell, i) => {
          const spec = M.usesColumns[i];
          if (!has(cell, 'x-grid3-td-' + spec.nativeColumnToken)) invalid();
          if (!spec.read)
            return {
              actualLabel: spec.actualLabel,
              nativeColumnToken: spec.nativeColumnToken,
              state: 'NOT_READ',
              rawValue: null,
              observedTotalCodepoints: 0,
            };
          valueSafe(cell);
          const rawValue = text(cell);
          if (
            ['Master:number', 'Master:name', 'Child:version'].includes(
              spec.nativeColumnToken,
            )
          )
            for (const a of nodes(cell, 'a[href]')) {
              const rawHref = a.getAttribute('href');
              if (typeof rawHref !== 'string' || rawHref.length > 2000)
                invalid();
              rawReferences.push({
                nativeColumnToken: spec.nativeColumnToken,
                rawHref,
              });
            }
          return {
            actualLabel: spec.actualLabel,
            nativeColumnToken: spec.nativeColumnToken,
            state: rawValue.trim() ? 'VALUE' : 'BLANK',
            rawValue,
            observedTotalCodepoints: [...rawValue].length,
          };
        });
        return { node: node(row), cells: values, rawReferences };
      });
  const usesWindow = (grid, component) => {
    const nativeHeaders = header(grid, M.usesColumns),
      rows = usesRows(grid),
      scrollers = nodes(grid, '.x-grid3-scroller').filter(
        (n) => n.closest('.x-grid-panel') === grid,
      );
    if (scrollers.length !== 1) invalid();
    const s = scrollers[0];
    const displays = nodes(component, '.my-paging-display').filter(
      (n) => !n.closest('.x-grid-panel') && visible(n),
    );
    if (displays.length > 1) invalid();
    let paging = null;
    if (displays.length === 1) {
      const display = displays[0];
      let panel = grid.parentElement;
      while (panel && panel !== component && !panel.contains(display))
        panel = panel.parentElement;
      if (panel && panel !== component) {
        valueSafe(display);
        const path = (start) => {
          const out = [];
          for (let n = start; n; n = n.parentElement) {
            out.push(node(n));
            if (n === panel) return out;
          }
          invalid();
        };
        paging = {
          display: { node: node(display), rawText: text(display, 200) },
          panel: node(panel),
          gridPath: path(grid),
          displayPath: path(display),
        };
      }
    }
    return {
      node: node(grid),
      nativeHeaders,
      rows,
      empty: nodes(grid, '.x-grid-empty').map((n) => ({
        node: node(n),
        rawText: text(n, 200),
      })),
      scroll: {
        top: s.scrollTop,
        height: s.scrollHeight,
        viewport: s.clientHeight,
      },
      paging,
      counts: nodes(grid, '.tableCount').map((n) => ({
        node: node(n),
        rawText: text(n, 200),
      })),
      pagers: nodes(
        grid,
        '.x-tbar-page-number,.x-tbar-page-next,.x-paging-info',
      ).map(node),
    };
  };
  const loading = (component) =>
    nodes(
      component,
      '.ext-el-mask,.ext-el-mask-msg,.x-mask,.x-mask-loading,.x-loading,.x-grid3-loading,.x-masked,[aria-busy="true"],[role="progressbar"],[data-loading]',
    )
      .filter(visible)
      .map(node);
  const configDialog = (dialog) => {
    valueSafe(dialog);
    if (dialog.id !== 'catDialogWidget' || !visible(dialog)) invalid();
    const headings = nodes(dialog, 'span.x-window-header-text[role="heading"]');
    if (headings.length !== 1 || text(headings[0], 100) !== 'Current Filter')
      invalid();
    const grids = nodes(dialog, '.x-grid-panel');
    if (grids.length !== 1) invalid();
    header(grids[0], [
      { actualLabel: '', nativeColumnToken: 'numberer' },
      { actualLabel: 'Type', nativeColumnToken: 'type' },
      { actualLabel: 'Details', nativeColumnToken: 'detail' },
    ]);
    const rows = nodes(grids[0], '.x-grid3-row');
    if (rows.length !== 1) invalid();
    const cells = nodes(rows[0], 'td.x-grid3-cell');
    if (cells.length !== 3) invalid();
    const inputs = nodes(
        dialog,
        'input,select,textarea,[contenteditable="true"]',
      ),
      boxes = inputs.filter(
        (n) => n.tagName === 'INPUT' && n.type === 'checkbox',
      );
    if (boxes.length !== 2) invalid();
    const focus = inputs.filter((n) => !boxes.includes(n));
    if (focus.length > 1) invalid();
    const focusProof = focus.map((n) => {
      valueSafe(n);
      if (
        n.tagName !== 'INPUT' ||
        n.type !== 'text' ||
        n.id ||
        n.getAttribute('name') !== null ||
        classes(n).join(' ') !== '_focus' ||
        n
          .getAttributeNames()
          .some((k) => !['class', 'type', 'tabindex', 'style'].includes(k))
      )
        invalid();
      if (n.value !== '') invalid();
      return {
        control: rawControl(n),
        rawValue: n.value,
        purpose: 'GWT_FOCUS_SENTINEL',
      };
    });
    const checkboxes = boxes.map((n, i) => {
      valueSafe(n);
      const labels = nodes(dialog, 'label.x-form-cb-label').filter(
        (l) => l.getAttribute('for') === n.id,
      );
      if (
        !has(n, 'x-form-checkbox') ||
        labels.length !== 1 ||
        text(labels[0], 100) !== M.checkboxLabels[i]
      )
        invalid();
      return {
        control: rawControl(n),
        label: text(labels[0], 100),
        checked: n.checked,
      };
    });
    const rawCells = cells.map((n) => {
      valueSafe(n);
      return text(n, 100);
    });
    if (rawCells[0] !== '1') invalid();
    const close = nodes(dialog, 'button.x-btn-text').filter(
      (n) => text(n, 100) === 'Close',
    );
    if (close.length !== 1) invalid();
    return {
      node: node(dialog),
      configuration: {
        typeRaw: rawCells[1],
        detailsRaw: rawCells[2],
        applyToTopLevelObjectChecked: checkboxes[0].checked,
        applyLatestForUnresolvedDependentsChecked: checkboxes[1].checked,
      },
      checkboxes,
      focus: focusProof,
      close: node(close[0]),
    };
  };
  const attrMatches = (a, owner) => {
    const field = (label) =>
      a.fields.find((f) => f.label.trim() === label)?.rawValue;
    if (
      field('Number:') !== owner.number ||
      field('Type:') !== M.nativeHeaderType ||
      field('Version:') !==
        owner.sourceVersion.rawRevision + '.' + owner.sourceVersion.rawIteration
    )
      return false;
    const outer = owner.sourceModifiedRaw?.match(
        /^(\d{4}-\d{2}-\d{2} \d{2}:\d{2})(?::(\d{2}))? CST$/u,
      ),
      inner = field('Last Modified:')?.match(
        /^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}):(\d{2}) UTC\+8$/u,
      );
    return (
      !!outer &&
      !!inner &&
      outer[1] === inner[1] &&
      (outer[2] === undefined || outer[2] === inner[2])
    );
  };
  const queryWindow = (component, _usesGrid) => {
    const inputs = nodes(
      component,
      'input,select,textarea,[contenteditable="true"]',
    );
    const find = inputs.filter(
      (n) =>
        n.tagName === 'INPUT' &&
        n.type === 'text' &&
        visible(n) &&
        has(n, 'x-form-empty-field'),
    );
    if (find.length !== 1) invalid();
    valueSafe(find[0]);
    const findRaw = find[0].value;
    if (
      findRaw !== M.findPlaceholder ||
      find[0].getAttribute('placeholder') !== null
    )
      invalid();
    const other = inputs.filter((n) => n !== find[0]);
    const searches = other.map((n) => {
      valueSafe(n);
      if (
        n.tagName !== 'INPUT' ||
        n.type !== 'text' ||
        visible(n) ||
        !has(n, 'x-form-empty-field') ||
        n.getAttribute('name') !== null ||
        n.getAttribute('placeholder') !== null
      )
        invalid();
      const rawValue = n.value;
      if (rawValue !== M.usesSearchPlaceholder) invalid();
      return { control: rawControl(n), rawValue };
    });
    // The current view menu and paging/search control roster are separate native
    // facts. Missing their reviewed binding never becomes an empty-query claim.
    const controls = nodes(
      component,
      'button,a[aria-pressed],input,select,textarea',
    )
      .filter((n) => !n.closest('.x-grid-panel,fieldset'))
      .map((n) => ({
        control: rawControl(n),
        images: nodes(n, 'img').map((i) => ({
          rawSrc: i.getAttribute('src'),
          rawStyle: i.getAttribute('style'),
        })),
      }));
    return {
      find: { control: rawControl(find[0]), rawValue: findRaw },
      searches,
      controls,
      viewState: 'NOT_READ',
      viewRaw: null,
      queryCoverage: 'UNPROVEN',
    };
  };
  const projection = (value) => {
    const out = clone(value);
    const visit = (v, key = '') => {
      if (Array.isArray(v)) {
        v.forEach((x) => visit(x, key));
        return;
      }
      if (!v || typeof v !== 'object') return;
      // Only schema-bound native metadata uses this projection, after validation.
      if (
        v.tag &&
        typeof v.rawClassName === 'string' &&
        typeof v.visible === 'boolean' &&
        typeof v.id === 'string' &&
        /^(?:x-menu-el-)?x-auto-?\d+(?:_x-auto-\d+|-input|-display|__(?:Info|DOCSB[.]uses))?$/u.test(
          v.id,
        )
      )
        v.id = '[GWT_UI_ID]';
      for (const k of [
        'ariaDescribedBy',
        'containerAriaDescribedBy',
        'toolbarAncestorId',
        'menuLabelledBy',
        'labelFor',
      ])
        if (typeof v[k] === 'string' && /^x-auto-?\d+$/u.test(v[k]))
          v[k] = '[GWT_UI_ID]';
      for (const [k, x] of Object.entries(v))
        if (
          typeof x === 'string' &&
          /^(?:gridParentId|gridContainerParentId|toolbarParentId|toolbarContainerParentId|displayToolbarAncestorId)$/u.test(
            k,
          ) &&
          /^x-auto-\d+$/u.test(x)
        )
          v[k] = '[GWT_UI_ID]';
      if (typeof v.rawInformationIds?.[0] === 'string')
        v.rawInformationIds = v.rawInformationIds.map((id) =>
          id.replace(
            /(miniInfo_(?:OR|VR):wt\.doc\.WTDocument:\d{1,24})\d{4}$/u,
            '$1[UI_SUFFIX]',
          ),
        );
      if (typeof v.id === 'string' && v.id.startsWith('miniInfo_'))
        v.id = v.id.replace(/\d{4}$/u, '[UI_SUFFIX]');
      Object.values(v).forEach((x) => visit(x));
    };
    visit(out);
    return out;
  };
  const uiKnown = (ui, paging) => {
    if (
      ui?.state !== 'VALUE' ||
      ui.reasonCode !== null ||
      ui.settledReads !== 2 ||
      ui.closedReadBack !== true ||
      ui.optionsChanged !== false ||
      paging?.state !== 'VALUE' ||
      !sharedGwt
    )
      return false;
    return (
      [ui.before, ui.after].every(
        (s) =>
          sharedGwt.querySnapshotMetadataKnown(s) &&
          sharedGwt.queryControlsKnown(
            s.controls,
            paging.capture,
            s.search,
            s.paths,
          ) &&
          stable(s.entries.map((e) => e.rawText)) ===
            stable(['Default', '\u00a0', 'Manage Table Views']) &&
          s.search.rawValue === M.usesSearchPlaceholder,
      ) && stable(projection(ui.before)) === stable(projection(ui.after))
    );
  };
  const status = (proof) => {
    const fs = [proof.before, proof.after],
      stableReads =
        proof.settledReads === 2 &&
        stable(projection(proof.before)) === stable(projection(proof.after));
    const continuity = proof.ownerContinuity,
      final = continuity?.finalAttributes;
    const ownerContinuityKnown =
      continuity?.checkOrder ===
        'INITIAL_ATTRIBUTES_USES_QUERY_FINAL_ATTRIBUTES' &&
      Number.isFinite(continuity.initialInnerDocument?.timeOrigin) &&
      stable(continuity.initialInnerDocument) ===
        stable(continuity.finalInnerDocument) &&
      final?.settledReads === 2 &&
      fs.every(
        (f) =>
          f.frame.innerTimeOrigin ===
            continuity.initialInnerDocument.timeOrigin &&
          f.frame.innerURL === continuity.initialInnerDocument.url &&
          stable(projection(f.attributes.before)) ===
            stable(projection(final.before)) &&
          stable(projection(f.attributes.after)) ===
            stable(projection(final.after)),
      );
    const own = fs.every(
      (f) =>
        f.attributesOwnerBound === true &&
        f.tree.rows.length === 1 &&
        f.tree.rows[0].ownIdentity &&
        f.tree.rows[0].selected &&
        f.tree.rows[0].rawInformationIds.length === 1 &&
        f.tree.counts.length === 0 &&
        f.tree.pagers.length === 0,
    );
    const nativeEnd = fs.every(
      (f) =>
        f.uses.paging?.display.rawText === M.nativeEmptyText &&
        f.uses.paging.display.node.visible &&
        f.uses.nativePaging?.state === 'VALUE' &&
        f.uses.nativePaging.capture.display.rawText === M.nativeEmptyText &&
        stable(f.uses.paging.display.node) ===
          stable(f.uses.nativePaging.capture.display.node) &&
        f.uses.counts.length === 0 &&
        f.uses.pagers.length === 0 &&
        f.uses.nativePaging.capture.navigationControls.length === 0 &&
        [
          'rowNodes',
          'hiddenRowNodes',
          'cellNodes',
          'rowShellNodes',
          'otherGrids',
        ].every((k) => f.uses.nativePaging.capture.structure[k] === 0) &&
        f.uses.nativePaging.capture.structure.scrollerVisible === true &&
        f.uses.nativePaging.capture.loadingMarkers.every(
          (n) =>
            !n.dataLoadingPresent &&
            (!n.node.visible || n.ariaBusy === 'false'),
        ) &&
        f.uses.rows.length === 0 &&
        f.uses.empty.length === 1 &&
        f.uses.empty[0].node.visible &&
        f.uses.empty[0].rawText === '\u00a0' &&
        f.uses.scroll.top === 0 &&
        f.uses.scroll.viewport > 0 &&
        f.uses.scroll.viewport === f.uses.scroll.height &&
        f.tree.scroll.top === 0 &&
        f.tree.scroll.viewport > 0 &&
        f.tree.scroll.viewport === f.tree.scroll.height &&
        !f.loading.length,
    );
    const queryKnown = fs.every(
      (f) =>
        uiKnown(f.query.nativeQueryUi, f.uses.nativePaging) &&
        f.query.find.rawValue === M.findPlaceholder &&
        f.query.searches.length === 1 &&
        f.query.searches[0].rawValue === M.usesSearchPlaceholder &&
        stable(f.currentFilter.configuration) === stable(M.configuration),
    );
    const complete =
      stableReads && ownerContinuityKnown && own && nativeEnd && queryKnown;
    return {
      complete,
      nativeEndObserved: nativeEnd,
      queryKnown,
      stableReads,
      ownerContinuityKnown,
      endpointState: complete
        ? 'OWNER_BOUND_NATIVE_EMPTY_STRUCTURE'
        : nativeEnd
          ? 'OBSERVED_NATIVE_NO_DATA'
          : 'UNCONFIRMED',
      reasonCode: complete
        ? null
        : !queryKnown
          ? 'TDMS_COMPLETE_SB_STRUCTURE_QUERY_UNPROVEN'
          : M.stopReason,
    };
  };
  async function capture({
    read: _read,
    surface,
    tab,
    input,
    owner,
    normalContext,
    guard,
    readNativePaging,
    readUsesQueryUi,
  }) {
    if (typeof guard !== 'function') invalid();
    let innerDocument = null,
      innerWindow = null,
      innerTimeOrigin = null;
    const alive = () => {
      guard();
      const current = context(surface, tab, input, owner, normalContext);
      if (
        innerDocument !== null &&
        (current === null ||
          current.inner !== innerDocument ||
          current.inner.defaultView !== innerWindow ||
          current.inner.defaultView?.performance?.timeOrigin !==
            innerTimeOrigin)
      )
        invalid();
      return current;
    };
    let ctx = alive();
    if (ctx === null) return null;
    innerDocument = ctx.inner;
    innerWindow = innerDocument.defaultView;
    innerTimeOrigin = innerWindow?.performance?.timeOrigin;
    if (!Number.isFinite(innerTimeOrigin) || innerTimeOrigin <= 0) invalid();
    const initialInnerDocument = {
      url: innerDocument.URL,
      timeOrigin: innerTimeOrigin,
    };
    const pause = async () => {
      if (Date.now() + 100 >= input.executionDeadlineMs) invalid();
      await new Promise((r) => setTimeout(r, 100));
      alive();
    };
    const activate = async (suffix, label) => {
      let c = alive();
      const a = innerTab(c.component, suffix, label);
      if (!a.proof.active) {
        a.action.click();
        await pause();
        c = alive();
        if (!innerTab(c.component, suffix, label).proof.active) invalid();
      }
    };
    await activate('__Info', 'Attributes');
    const a = attributes(alive().component);
    await pause();
    const b = attributes(alive().component);
    if (
      stable(projection(a)) !== stable(projection(b)) ||
      !attrMatches(a, owner) ||
      !attrMatches(b, owner)
    )
      invalid();
    const boundAttributes = { before: a, after: b, settledReads: 2 };
    await activate('__DOCSB.uses', 'Uses');
    ctx = alive();
    const existing = nodes(ctx.inner, '#catDialogWidget').filter(visible);
    if (existing.length) invalid();
    const triggers = nodes(ctx.component, 'button.x-btn-text').filter((n) =>
      nodes(n, 'img').some((i) =>
        (i.getAttribute('style') || '').includes(
          '/filter_structure_current.png',
        ),
      ),
    );
    if (triggers.length !== 1) invalid();
    valueSafe(triggers[0]);
    if (text(triggers[0], 100) !== 'Current Filter') invalid();
    triggers[0].click();
    await pause();
    const dialog = one(alive().inner, '#catDialogWidget');
    let first, second;
    try {
      first = configDialog(dialog);
      await pause();
      second = configDialog(dialog);
      if (stable(projection(first)) !== stable(projection(second))) invalid();
    } finally {
      alive();
      const closes = nodes(dialog, 'button.x-btn-text').filter(
        (n) => text(n, 100) === 'Close',
      );
      if (closes.length !== 1) invalid();
      closes[0].click();
      await pause();
      if (nodes(alive().inner, '#catDialogWidget').some(visible)) invalid();
    }
    const filter = {
      before: first,
      after: second,
      configuration: second.configuration,
      settledReads: 2,
      closedReadBack: true,
      optionsChanged: false,
    };
    const queryContext = alive(),
      queryGrids = nodes(queryContext.component, '.x-grid-panel').filter(
        (n) => n.getAttribute('role') === null,
      );
    if (queryGrids.length !== 1) invalid();
    const nativeQueryUi =
      typeof readUsesQueryUi === 'function'
        ? await readUsesQueryUi(
            queryContext.component,
            queryGrids[0],
            () => alive(),
            owner.sourceRecordId,
          )
        : {
            state: 'NOT_READ',
            reasonCode: 'TDMS_SB_USES_QUERY_UI_UNPROVEN',
            before: null,
            after: null,
            settledReads: 0,
            closedReadBack: true,
            optionsChanged: false,
          };
    const frame = () => {
      const c = alive(),
        grids = nodes(c.component, '.x-grid-panel').filter(
          (n) => !n.parentElement.closest('.x-grid-panel'),
        );
      if (grids.length !== 2) invalid();
      const trees = grids.filter((n) => n.getAttribute('role') === 'treegrid'),
        usages = grids.filter((n) => n.getAttribute('role') === null);
      if (trees.length !== 1 || usages.length !== 1) invalid();
      const tree = rootTree(trees[0], owner),
        uses = usesWindow(usages[0], c.component),
        query = queryWindow(c.component, usages[0]);
      uses.nativePaging =
        typeof readNativePaging === 'function'
          ? readNativePaging(c.component, usages[0])
          : { state: 'NOT_READ', capture: null };
      query.nativeQueryUi = nativeQueryUi;
      return {
        frame: {
          node: node(c.frame),
          rawSrc: c.rawSrc,
          innerURL: c.inner.URL,
          innerTimeOrigin,
          title: c.inner.title,
          readyState: c.inner.readyState,
        },
        component: node(c.component),
        innerTabs: [
          innerTab(c.component, '__Info', 'Attributes').proof,
          innerTab(c.component, '__DOCSB.uses', 'Uses').proof,
        ],
        attributes: boundAttributes,
        attributesOwnerBound: true,
        currentFilter: filter,
        tree,
        uses,
        query,
        loading: loading(c.component),
      };
    };
    const before = frame();
    await pause();
    const after = frame();
    // Later Uses/query facts cannot inherit stale Attributes evidence. Return to
    // the actual panel and compare new reads to both original raw reads; never
    // replace the original owner/version/modified evidence with the later data.
    await activate('__Info', 'Attributes');
    const finalA = attributes(alive().component);
    await pause();
    const finalB = attributes(alive().component);
    if (
      stable(projection(finalA)) !== stable(projection(a)) ||
      stable(projection(finalB)) !== stable(projection(b)) ||
      !attrMatches(finalA, owner) ||
      !attrMatches(finalB, owner)
    )
      invalid();
    const finalContext = alive(),
      ownerContinuity = {
        checkOrder: 'INITIAL_ATTRIBUTES_USES_QUERY_FINAL_ATTRIBUTES',
        initialInnerDocument,
        finalInnerDocument: {
          url: finalContext.inner.URL,
          timeOrigin: finalContext.inner.defaultView.performance.timeOrigin,
        },
        finalAttributes: { before: finalA, after: finalB, settledReads: 2 },
      };
    const proof = {
      schemaVersion: M.schemaVersion,
      modelRevision: M.modelRevision,
      scopeId: input.scopeId,
      nativeTypeId: M.nativeTypeId,
      ownerSourceRecordId: owner.sourceRecordId,
      ownerSourceVersion: clone(owner.sourceVersion),
      ownerSourceModifiedRaw: owner.sourceModifiedRaw,
      businessSubtype: input.scopeId,
      normalBinding: {
        url: normalContext.url,
        timeOrigin: normalContext.timeOrigin,
      },
      tabId: M.tabId,
      panelLocator: M.panelLocator,
      purpose: M.purpose,
      before,
      after,
      settledReads: 2,
      ownerContinuity,
    };
    if (!status(proof).stableReads) invalid();
    return proof;
  }
  function validate(proof, { scopeId, owner, tab, read } = {}) {
    if (tab?.tabId !== M.tabId && proof?.schemaVersion !== M.schemaVersion)
      return null;
    if (
      !currentOwner(scopeId, owner) ||
      tab?.tabId !== M.tabId ||
      tab.panelLocator !== M.panelLocator ||
      tab.label !== M.label
    )
      invalid();
    if (proof === undefined)
      return {
        complete: false,
        reasonCode: 'TDMS_COMPLETE_SB_STRUCTURE_PROOF_MISSING',
      };
    if (
      !exact(proof, [
        'schemaVersion',
        'modelRevision',
        'scopeId',
        'nativeTypeId',
        'ownerSourceRecordId',
        'ownerSourceVersion',
        'ownerSourceModifiedRaw',
        'businessSubtype',
        'normalBinding',
        'tabId',
        'panelLocator',
        'purpose',
        'before',
        'after',
        'settledReads',
        'ownerContinuity',
      ]) ||
      proof.schemaVersion !== M.schemaVersion ||
      proof.modelRevision !== M.modelRevision ||
      proof.scopeId !== scopeId ||
      proof.businessSubtype !== scopeId ||
      proof.nativeTypeId !== M.nativeTypeId ||
      proof.ownerSourceRecordId !== owner.sourceRecordId ||
      stable(proof.ownerSourceVersion) !== stable(owner.sourceVersion) ||
      proof.ownerSourceModifiedRaw !== owner.sourceModifiedRaw ||
      proof.tabId !== M.tabId ||
      proof.panelLocator !== M.panelLocator ||
      proof.purpose !== M.purpose ||
      proof.settledReads !== 2 ||
      !exact(proof.normalBinding, ['url', 'timeOrigin']) ||
      !Number.isFinite(proof.normalBinding.timeOrigin) ||
      proof.normalBinding.timeOrigin <= 0 ||
      stable(proof.normalBinding) !== stable(read?.domDocumentIdentity)
    )
      invalid();
    let route, ownRoute;
    try {
      route = new URL(proof.normalBinding.url);
      ownRoute = new URL(route.hash.replace(/^#ptc1/u, ''), route.origin);
    } catch {
      invalid();
    }
    if (
      route.pathname !== '/Windchill/app/' ||
      ownRoute.pathname !== '/tcomp/infoPage' ||
      ownRoute.searchParams.getAll('oid').length !== 1 ||
      ownRoute.searchParams.get('oid') !== owner.sourceRecordId
    )
      invalid();
    const continuity = proof.ownerContinuity;
    if (
      !exact(continuity, [
        'checkOrder',
        'initialInnerDocument',
        'finalInnerDocument',
        'finalAttributes',
      ]) ||
      continuity.checkOrder !==
        'INITIAL_ATTRIBUTES_USES_QUERY_FINAL_ATTRIBUTES' ||
      !exact(continuity.initialInnerDocument, ['url', 'timeOrigin']) ||
      !exact(continuity.finalInnerDocument, ['url', 'timeOrigin']) ||
      !Number.isFinite(continuity.initialInnerDocument.timeOrigin) ||
      continuity.initialInnerDocument.timeOrigin <= 0 ||
      stable(continuity.initialInnerDocument) !==
        stable(continuity.finalInnerDocument) ||
      !exact(continuity.finalAttributes, ['before', 'after', 'settledReads']) ||
      continuity.finalAttributes.settledReads !== 2
    )
      invalid();
    for (const f of [proof.before, proof.after]) {
      if (
        !exact(f, [
          'frame',
          'component',
          'innerTabs',
          'attributes',
          'attributesOwnerBound',
          'currentFilter',
          'tree',
          'uses',
          'query',
          'loading',
        ]) ||
        f.frame.node.id !== M.frameId ||
        f.frame.title !== M.innerTitle ||
        f.frame.readyState !== 'complete' ||
        f.component.id !== M.componentId ||
        f.attributesOwnerBound !== true ||
        !attrMatches(f.attributes.before, owner) ||
        !attrMatches(f.attributes.after, owner) ||
        f.attributes.settledReads !== 2 ||
        stable(projection(f.attributes.before)) !==
          stable(projection(f.attributes.after))
      )
        invalid();
      for (const a of [
        f.attributes.before,
        f.attributes.after,
        continuity.finalAttributes.before,
        continuity.finalAttributes.after,
      ]) {
        if (
          !Array.isArray(a.fields) ||
          a.fields.length !== M.attributeLabels.length
        )
          invalid();
        for (const [i, field] of a.fields.entries()) {
          if (
            !exact(field, ['label', 'state', 'rawValue']) ||
            field.label.trim() !== M.attributeLabels[i]
          )
            invalid();
          if (M.attributeLabels[i] === 'Modified By:') {
            if (field.state !== 'NOT_READ' || field.rawValue !== null)
              invalid();
          } else if (
            !['VALUE', 'BLANK'].includes(field.state) ||
            typeof field.rawValue !== 'string' ||
            field.rawValue.length > 10000 ||
            (field.state === 'BLANK') !== (field.rawValue.trim() === '')
          )
            invalid();
        }
      }
      const origin = new URL(proof.normalBinding.url).origin;
      if (
        urlKnown(f.frame.rawSrc, origin, owner) !==
          urlKnown(f.frame.innerURL, origin, owner) ||
        f.frame.innerURL !== continuity.initialInnerDocument.url ||
        f.frame.innerTimeOrigin !==
          continuity.initialInnerDocument.timeOrigin ||
        stable(projection(f.attributes.before)) !==
          stable(projection(continuity.finalAttributes.before)) ||
        stable(projection(f.attributes.after)) !==
          stable(projection(continuity.finalAttributes.after))
      )
        invalid();
      if (
        !Array.isArray(f.tree.rows) ||
        !Array.isArray(f.uses.rows) ||
        !Array.isArray(f.loading)
      )
        invalid();
      for (const r of f.tree.rows) {
        if (r.ownIdentity !== (r.rawIdentity === owner.rawHeaderIdentifier))
          invalid();
        if (
          r.selected &&
          r.ownIdentity &&
          !r.rawInformationIds.every(
            (id) =>
              id.startsWith('miniInfo_' + owner.sourceRecordId) &&
              /^\d{4}$/u.test(
                id.slice(('miniInfo_' + owner.sourceRecordId).length),
              ),
          )
        )
          invalid();
      }
      if (
        f.uses.nativeHeaders.length !== M.usesColumns.length ||
        f.tree.nativeHeaders.length !== 1
      )
        invalid();
      for (const [i, h] of f.uses.nativeHeaders.entries())
        if (
          h.actualLabel !== M.usesColumns[i].actualLabel ||
          h.nativeColumnToken !== M.usesColumns[i].nativeColumnToken
        )
          invalid();
      for (const r of f.uses.rows) {
        if (r.cells.length !== M.usesColumns.length) invalid();
        for (const [i, c] of r.cells.entries()) {
          const spec = M.usesColumns[i];
          if (
            c.actualLabel !== spec.actualLabel ||
            c.nativeColumnToken !== spec.nativeColumnToken
          )
            invalid();
          if (
            !spec.read &&
            (c.state !== 'NOT_READ' ||
              c.rawValue !== null ||
              c.observedTotalCodepoints !== 0)
          )
            invalid();
        }
      }
      for (const d of [f.currentFilter.before, f.currentFilter.after]) {
        if (
          stable(d.configuration) !== stable(f.currentFilter.configuration) ||
          d.checkboxes?.length !== 2 ||
          d.focus?.length > 1
        )
          invalid();
        for (const [i, c] of d.checkboxes.entries())
          if (
            c.label !== M.checkboxLabels[i] ||
            typeof c.checked !== 'boolean' ||
            c.checked !==
              (i === 0
                ? d.configuration.applyToTopLevelObjectChecked
                : d.configuration.applyLatestForUnresolvedDependentsChecked)
          )
            invalid();
        for (const focus of d.focus)
          if (
            focus.purpose !== 'GWT_FOCUS_SENTINEL' ||
            focus.rawValue !== '' ||
            focus.control.typeRaw !== 'text' ||
            focus.control.nameRaw !== null ||
            focus.control.node.id !== null ||
            classes(focus.control.node.rawClassName).join(' ') !== '_focus'
          )
            invalid();
      }
      if (
        f.currentFilter.optionsChanged !== false ||
        f.currentFilter.closedReadBack !== true ||
        f.currentFilter.settledReads !== 2 ||
        stable(projection(f.currentFilter.before)) !==
          stable(projection(f.currentFilter.after))
      )
        invalid();
      if (
        f.query.queryCoverage !== 'UNPROVEN' ||
        f.query.viewState !== 'NOT_READ' ||
        f.query.viewRaw !== null
      )
        invalid();
      const ui = f.query.nativeQueryUi;
      if (
        !exact(ui, [
          'state',
          'reasonCode',
          'before',
          'after',
          'settledReads',
          'closedReadBack',
          'optionsChanged',
        ]) ||
        ui.closedReadBack !== true ||
        ui.optionsChanged !== false ||
        !['VALUE', 'NOT_READ'].includes(ui.state)
      )
        invalid();
      if (ui.state === 'VALUE' && !uiKnown(ui, f.uses.nativePaging)) invalid();
      if (
        ui.state === 'NOT_READ' &&
        (ui.before !== null || ui.after !== null || ui.settledReads !== 0)
      )
        invalid();
    }
    const s = status(proof);
    if (
      !s.stableReads ||
      tab.required !== true ||
      tab.state !== (s.complete ? 'VALUE' : 'NOT_READ') ||
      tab.reasonCode !== (s.complete ? null : M.stopReason)
    )
      invalid();
    return s;
  }
  function semanticProjection(value) {
    if (
      value?.schemaVersion === M.schemaVersion &&
      value.modelRevision === M.modelRevision
    ) {
      const p = projection(value);
      p.normalBinding = {
        ...p.normalBinding,
        timeOrigin: '@validated-sb-structure-time-origin',
      };
      if (p.ownerContinuity) {
        for (const side of ['initialInnerDocument', 'finalInnerDocument'])
          p.ownerContinuity[side] = {
            ...p.ownerContinuity[side],
            timeOrigin: '@validated-sb-structure-inner-time-origin',
          };
        for (const frame of [p.before, p.after])
          frame.frame.innerTimeOrigin =
            '@validated-sb-structure-inner-time-origin';
      }
      return p;
    }
    if (
      !currentOwner(value?.owner?.scopeEvidence?.businessType, value?.owner) ||
      !Array.isArray(value.tabs)
    )
      return value;
    const read = clone(value);
    let present = false;
    for (const tab of read.tabs)
      if (tab.purposeEvidence?.schemaVersion === M.schemaVersion) {
        tab.purposeEvidence = semanticProjection(tab.purposeEvidence);
        present = true;
      }
    for (const table of read.relationTables || [])
      if (table.relatedSurfaceEvidence?.schemaVersion === M.schemaVersion) {
        const p = table.relatedSurfaceEvidence,
          grid = p.after.uses.node.id,
          display = p.after.uses.paging?.display.node.id;
        if (table.gridId === grid) table.gridId = '[SB_GWT_USES_GRID]';
        if (
          table.countEvidence?.locator ===
          M.panelLocator + ' iframe#' + M.frameId + ' [id="' + display + '"]'
        )
          table.countEvidence.locator =
            M.panelLocator +
            ' iframe#' +
            M.frameId +
            ' [id="[SB_GWT_USES_DISPLAY]"]';
        for (const [i, row] of (table.rows || []).entries())
          if (row.nativeRowId === p.after.uses.rows[i]?.node.id)
            row.nativeRowId = '[SB_GWT_USES_ROW_' + i + ']';
        table.relatedSurfaceEvidence = semanticProjection(p);
        present = true;
      }
    if (present && read.domDocumentIdentity)
      read.domDocumentIdentity = {
        ...read.domDocumentIdentity,
        timeOrigin: '@validated-sb-structure-time-origin',
      };
    return present ? read : value;
  }
  function makeTable(proof) {
    const s = status(proof),
      zero = s.complete,
      rows = proof.after.uses.rows.map((r, i) => ({
        occurrenceId: M.tableId + '#' + i,
        globalIndex: null,
        nativeRowId: r.node.id,
        treePath: [],
        treeDepth: null,
        nativeRelationId: null,
        rawRole: null,
        rawDirection: null,
        cells: r.cells.map(
          ({ actualLabel, state, rawValue, observedTotalCodepoints }) => ({
            actualLabel,
            state,
            rawValue,
            observedTotalCodepoints,
          }),
        ),
        sourceLinks: [],
        observedVersion: {
          rawRevision: null,
          rawIteration: null,
          confirmation: 'VERSION_UNCONFIRMED',
        },
      }));
    const us = proof.after.uses.scroll,
      scroll = {
        ...us,
        atTop: us.top === 0,
        atBottom: us.top + us.viewport >= us.height,
      };
    return {
      tableId: M.tableId,
      tabId: M.tabId,
      tableTitle: M.tableTitle,
      panelLocator: M.panelLocator,
      gridId: proof.after.uses.node.id,
      relationshipRole: 'UNKNOWN',
      direction: 'UNKNOWN',
      rawHeaders: M.usesColumns.map((c) => c.actualLabel),
      reportedTotal: zero ? 0 : null,
      countEvidence: {
        rawText: zero ? M.nativeEmptyText : null,
        exact: zero,
        locator:
          M.panelLocator +
          ' iframe#' +
          M.frameId +
          ' [id="' +
          (proof.after.uses.paging?.display.node.id ||
            proof.after.uses.node.id) +
          '"]',
      },
      scanMode: 'DOM_ROWS',
      rows,
      windows: [
        {
          ordinal: 0,
          rowOccurrenceIds: rows.map((r) => r.occurrenceId),
          globalIndices: [],
          reportedTotal: zero ? 0 : null,
          pageRaw: null,
          scroll,
          nextControl: {
            present: false,
            enabled: false,
            terminalDeclared: false,
          },
          stableReads: 2,
          treePending: zero ? 0 : 1,
          observedAt: new Date().toISOString(),
        },
      ],
      treeExpansions: [],
      terminal: {
        kind: zero ? 'NATIVE_END' : 'UNCONFIRMED',
        total: zero ? 0 : null,
        captured: rows.length,
        allGlobalIndices: zero,
        allTreeNodesExpanded: zero,
        nativeTerminal: zero,
        trueZero: zero,
        settledReads: 2,
      },
      enumerationState: zero ? 'VALUE' : 'NOT_READ',
      stopReason: zero ? null : M.stopReason,
      ownerSourceRecordId: proof.ownerSourceRecordId,
      ownerSourceVersion: clone(proof.ownerSourceVersion),
      observedAt: new Date().toISOString(),
      relatedSurfaceEvidence: clone(proof),
    };
  }
  function validateTable(table, { scopeId, owner, read } = {}) {
    if (table?.tableId !== M.tableId || !currentOwner(scopeId, owner))
      return null;
    const tab = read?.tabs?.find((t) => t.tabId === M.tabId),
      s = validate(table.relatedSurfaceEvidence, { scopeId, owner, tab, read }),
      want = makeTable(table.relatedSurfaceEvidence);
    const project = (t) => {
      const out = clone(t);
      delete out.observedAt;
      delete out.windows;
      delete out.relatedSurfaceEvidence;
      return out;
    };
    if (stable(project(table)) !== stable(project(want))) invalid();
    const windows = table.windows;
    if (!Array.isArray(windows) || windows.length !== 1) invalid();
    const a = { ...windows[0] },
      b = { ...want.windows[0] };
    delete a.observedAt;
    delete b.observedAt;
    if (stable(a) !== stable(b)) invalid();
    return s;
  }
  return {
    model: M,
    isOwner: currentOwner,
    isTab,
    capture,
    validate,
    status,
    projection: semanticProjection,
    makeTable,
    validateTable,
    uiKnown,
  };
}

export const SB_DOCUMENT_STRUCTURE_ADAPTER =
  createReviewedSbDocumentStructureAdapter(
    REVIEWED_SB_DOCUMENT_STRUCTURE_MODEL,
    {
      queryControlsKnown: gwtQueryControlsKnown,
      querySnapshotMetadataKnown: gwtQuerySnapshotMetadataKnown,
    },
  );
