// Pure SB consumer model selectively vendored from Source 0.2.73 / handoff @8.
import { tdmsError } from './tdms-source.types';
// Exact native SBDocument renderer, not opinion qualification. A blank must be
// observed on this object/version; the development sample proves no other row.
export const REVIEWED_SB_ANONYMOUS_STRICT_BLANK_MODEL = Object.freeze({
  schemaVersion: 'wiselink.tdms-sb-anonymous-strict-blank.v1',
  modelRevision: 'tdms-reviewed-sb-anonymous-strict-blank@1',
  nativeTypeId: 'WCTYPE|wt.doc.WTDocument|com.airchina.SBDocument',
  nativeHeaderType: 'SB文档',
  scopeIds: ['SB', 'SIL', 'SB-IN', 'SL', 'MT'],
  tabId: 'infoPageinfoPanelID__infoPage_myTab_object_docInfoDefaultDetails',
  panelLocator: '#infoPage_myTab_object_docInfoDefaultDetails',
  sectionId: 'MoreAttributesGroup',
  dataStoreId: 'dataStoreMoreAttributesGroup',
  rowChildClasses: [
    'attributePanel-asterisk',
    'attributePanel-label',
    'attributePanel-value',
    'attributePanel-asterisk',
    'attributePanel-label',
    'attributePanel-value',
  ],
});
export function createReviewedSbAnonymousStrictBlank(M) {
  const exact = (v, ks) =>
    !!v &&
    typeof v === 'object' &&
    !Array.isArray(v) &&
    Object.keys(v).length === ks.length &&
    ks.every((k) => Object.hasOwn(v, k));
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const bad = () => {
    throw tdmsError('TDMS_COMPLETE_SB_ANONYMOUS_STRICT_BLANK_UNPROVEN');
  };
  const ownerKnown = (scopeId, o) =>
    M.scopeIds.includes(scopeId) &&
    o?.nativeTypeId === M.nativeTypeId &&
    o.rawHeaderType === M.nativeHeaderType &&
    o.nativeTypeEvidence?.state === 'VALUE' &&
    o.nativeTypeEvidence.rawValue === M.nativeTypeId &&
    o.scopeEvidence?.businessType === scopeId &&
    /^(?:OR|VR):wt\.doc\.WTDocument:\d{1,24}$/u.test(o.sourceRecordId || '') &&
    o.sourceVersion?.confirmation === 'SOURCE_DECLARED';
  function renderer(node) {
    if (
      node?.tagName !== 'TD' ||
      node.getAttribute('class') !== 'attributePanel-value' ||
      !same(node.getAttributeNames(), ['class']) ||
      node.childElementCount !== 0 ||
      node.childNodes.length !== 1 ||
      node.firstChild?.nodeType !== 3 ||
      node.firstChild.length !== 3
    )
      return null;
    const caption = node.previousElementSibling,
      row = node.parentElement,
      children = [...(row?.children || [])];
    if (
      row?.tagName !== 'TR' ||
      children.length !== 6 ||
      children.some(
        (n, i) =>
          n.tagName !== 'TD' ||
          n.getAttribute('class') !== M.rowChildClasses[i],
      ) ||
      children[4] !== caption ||
      children[5] !== node ||
      caption.childElementCount !== 0 ||
      caption.childNodes.length !== 1 ||
      caption.firstChild?.nodeType !== 3 ||
      caption.firstChild.length !== 1 ||
      !same(caption.getAttributeNames(), ['class'])
    )
      return null;
    // Finite Text.length checks precede the only value getters. Nonempty long
    // bodies are not read; no arbitrary whitespace is treated as a blank.
    const rawCaptionText = caption.firstChild.nodeValue,
      rawText = node.firstChild.nodeValue;
    if (
      rawCaptionText !== '\u00a0' ||
      rawText !== ' \u00a0 ' ||
      caption.innerHTML !== '&nbsp;' ||
      node.innerHTML !== ' &nbsp; '
    )
      return null;
    return {
      previousLabel: 'Description:',
      rowChildTags: children.map((n) => n.tagName),
      rowChildClasses: children.map((n) => n.getAttribute('class')),
      captionChildOneBased: 5,
      valueChildOneBased: 6,
      captionTag: 'TD',
      captionClass: 'attributePanel-label',
      captionAttributeNames: ['class'],
      rawCaptionText,
      captionChildNodeTypes: [3],
      captionInnerHTML: '&nbsp;',
      valueTag: 'TD',
      valueClass: 'attributePanel-value',
      valueAttributeNames: ['class'],
      valueChildNodeTypes: [3],
      valueChildElementCount: 0,
      linkCount: 0,
      editorCount: 0,
      cellInnerHTML: ' &nbsp; ',
      rawText,
      observedTotalCodepoints: 3,
      truncated: false,
    };
  }
  function rendererKnown(r) {
    const keys = [
      'previousLabel',
      'rowChildTags',
      'rowChildClasses',
      'captionChildOneBased',
      'valueChildOneBased',
      'captionTag',
      'captionClass',
      'captionAttributeNames',
      'rawCaptionText',
      'captionChildNodeTypes',
      'captionInnerHTML',
      'valueTag',
      'valueClass',
      'valueAttributeNames',
      'valueChildNodeTypes',
      'valueChildElementCount',
      'linkCount',
      'editorCount',
      'cellInnerHTML',
      'rawText',
      'observedTotalCodepoints',
      'truncated',
    ];
    return (
      exact(r, keys) &&
      r.previousLabel === 'Description:' &&
      same(r.rowChildTags, ['TD', 'TD', 'TD', 'TD', 'TD', 'TD']) &&
      same(r.rowChildClasses, M.rowChildClasses) &&
      r.captionChildOneBased === 5 &&
      r.valueChildOneBased === 6 &&
      r.captionTag === 'TD' &&
      r.captionClass === 'attributePanel-label' &&
      same(r.captionAttributeNames, ['class']) &&
      r.rawCaptionText === '\u00a0' &&
      same(r.captionChildNodeTypes, [3]) &&
      r.captionInnerHTML === '&nbsp;' &&
      r.valueTag === 'TD' &&
      r.valueClass === 'attributePanel-value' &&
      same(r.valueAttributeNames, ['class']) &&
      same(r.valueChildNodeTypes, [3]) &&
      r.valueChildElementCount === 0 &&
      r.linkCount === 0 &&
      r.editorCount === 0 &&
      r.cellInnerHTML === ' &nbsp; ' &&
      r.rawText === ' \u00a0 ' &&
      r.observedTotalCodepoints === 3 &&
      r.truncated === false
    );
  }
  function validate(
    e,
    {
      scopeId,
      owner,
      sourceContext,
      documentIdentity,
      fieldId,
      canonicalFieldId = fieldId,
      tabId = M.tabId,
      panelLocator = M.panelLocator,
      use = 'CANONICAL',
    } = {},
  ) {
    if (
      !ownerKnown(scopeId, owner) ||
      !exact(e, [
        'schemaVersion',
        'modelRevision',
        'semanticPurpose',
        'use',
        'scopeId',
        'nativeTypeId',
        'ownerSourceRecordId',
        'ownerSourceVersion',
        'ownerSourceModifiedRaw',
        'ownStateRaw',
        'sourceContext',
        'normalBinding',
        'tabId',
        'panelLocator',
        'fieldId',
        'canonicalFieldId',
        'before',
        'after',
        'settledReads',
      ]) ||
      e.schemaVersion !== M.schemaVersion ||
      e.modelRevision !== M.modelRevision ||
      e.semanticPurpose !== 'SEMANTIC_PURPOSE_UNKNOWN' ||
      e.use !== use ||
      !['CANONICAL', 'ALIAS'].includes(use) ||
      e.scopeId !== scopeId ||
      e.nativeTypeId !== M.nativeTypeId ||
      e.ownerSourceRecordId !== owner.sourceRecordId ||
      !same(e.ownerSourceVersion, owner.sourceVersion) ||
      e.ownerSourceModifiedRaw !== owner.sourceModifiedRaw ||
      e.ownStateRaw !== owner.stateRaw ||
      !same(e.sourceContext, sourceContext) ||
      e.tabId !== tabId ||
      e.panelLocator !== panelLocator ||
      e.fieldId !== fieldId ||
      e.canonicalFieldId !== canonicalFieldId ||
      typeof fieldId !== 'string' ||
      !fieldId.startsWith(panelLocator + ' #' + M.dataStoreId + ' > ') ||
      !fieldId.endsWith(' > tr:nth-child(1) > td:nth-child(6)') ||
      typeof canonicalFieldId !== 'string' ||
      !canonicalFieldId.startsWith(
        M.panelLocator + ' #' + M.dataStoreId + ' > ',
      ) ||
      !canonicalFieldId.endsWith(' > tr:nth-child(1) > td:nth-child(6)') ||
      (use === 'CANONICAL' &&
        (tabId !== M.tabId ||
          panelLocator !== M.panelLocator ||
          canonicalFieldId !== fieldId)) ||
      !exact(e.normalBinding, ['url', 'timeOrigin']) ||
      !same(e.normalBinding, documentIdentity) ||
      !Number.isFinite(e.normalBinding.timeOrigin) ||
      e.normalBinding.timeOrigin <= 0 ||
      e.settledReads !== 2 ||
      !rendererKnown(e.before) ||
      !rendererKnown(e.after) ||
      !same(e.before, e.after)
    )
      bad();
    let u, r;
    try {
      u = new URL(e.normalBinding.url);
      r = new URL(u.hash.replace(/^#ptc1/u, ''), u.origin);
    } catch {
      bad();
    }
    if (
      u.origin !== sourceContext?.sourceInstanceOrigin ||
      u.pathname !== '/Windchill/app/' ||
      u.username ||
      u.password ||
      r.origin !== u.origin ||
      r.username ||
      r.password ||
      r.pathname !== '/tcomp/infoPage' ||
      r.searchParams.getAll('oid').length !== 1 ||
      r.searchParams.get('oid') !== owner.sourceRecordId
    )
      bad();
    return true;
  }
  function field(e, { scopeId, owner, read, field: f } = {}) {
    validate(e, {
      scopeId,
      owner,
      sourceContext: read.sourceContext,
      documentIdentity: read.domDocumentIdentity,
      fieldId: f.fieldId,
    });
    if (
      f.value?.state !== 'BLANK' ||
      f.value.actualLabel !== '' ||
      f.value.rawValue !== '' ||
      f.value.observedTotalCodepoints !== 0 ||
      f.links?.length !== 0 ||
      f.rawCaptionText !== '\u00a0'
    )
      bad();
    return true;
  }
  function project(value) {
    if (
      value?.schemaVersion === M.schemaVersion &&
      value.modelRevision === M.modelRevision
    ) {
      const out = JSON.parse(JSON.stringify(value));
      out.normalBinding.timeOrigin =
        '@validated-sb-anonymous-blank-time-origin';
      return out;
    }
    if (
      !value?.owner ||
      !M.scopeIds.includes(value.owner.scopeEvidence?.businessType) ||
      !Array.isArray(value.fields)
    )
      return value;
    const out = JSON.parse(JSON.stringify(value));
    if (
      out.fields.some((f) => f.strictBlankEvidence) &&
      out.domDocumentIdentity
    )
      out.domDocumentIdentity.timeOrigin =
        '@validated-sb-anonymous-blank-time-origin';
    for (const f of out.fields)
      if (f.strictBlankEvidence)
        f.strictBlankEvidence = project(f.strictBlankEvidence);
    for (const t of out.tabs || [])
      for (const side of ['before', 'after'])
        for (const f of t.purposeEvidence?.[side]?.aliasFields || [])
          if (f.strictBlankEvidence)
            f.strictBlankEvidence = project(f.strictBlankEvidence);
    return out;
  }
  return {
    model: M,
    ownerKnown,
    renderer,
    rendererKnown,
    validate,
    field,
    project,
  };
}
export const SB_ANONYMOUS_STRICT_BLANK = createReviewedSbAnonymousStrictBlank(
  REVIEWED_SB_ANONYMOUS_STRICT_BLANK_MODEL,
);
