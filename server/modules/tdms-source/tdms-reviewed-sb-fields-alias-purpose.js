// Pure SB consumer model selectively vendored from Source 0.2.73 / handoff @8.
import { tdmsError } from './tdms-source.types';
import { SB_ANONYMOUS_STRICT_BLANK as sbBlank } from './tdms-reviewed-sb-anonymous-strict-blank';
export const REVIEWED_SB_FIELDS_ALIAS_MODEL = Object.freeze({
  schemaVersion: 'wiselink.tdms-sb-fields-alias.v1',
  modelRevision: 'tdms-reviewed-sb-fields-alias@1',
  reasonCode: 'TDMS_COMPLETE_SB_FIELDS_CANONICAL_ALIAS',
  canonicalTabId:
    'infoPageinfoPanelID__infoPage_myTab_object_docInfoDefaultDetails',
  panels: [
    {
      tabId: 'infoPageinfoPanelID__infoPage_myTab_tab_jcaGen_1902225244',
      label: '新建选项卡 1',
      panelLocator: '#infoPage_myTab_tab_jcaGen_1902225244',
      componentIds: [
        'infoPage_myTab_tab_jcaGen_1902225244_objectattributes_tocItem',
        'infoPage_myTab_tab_jcaGen_1902225244_historylegacyLCHistory_tocItem',
        'wrap_infoPage_myTab_tab_jcaGen_1902225244_objectattributes',
        'wrap_infoPage_myTab_tab_jcaGen_1902225244_historylegacyLCHistory',
      ],
      grids: [
        {
          gridId: 'lifecycleHistoryTableId',
          columns: [
            { actualLabel: '', nativeColumnToken: 'checker' },
            {
              actualLabel: 'Life Cycle Name',
              nativeColumnToken: 'lifeCycleName',
            },
            { actualLabel: 'Team', nativeColumnToken: 'teamTemplateIdentity' },
            { actualLabel: 'State', nativeColumnToken: 'state' },
            {
              actualLabel: 'Action',
              nativeColumnToken: 'lifecyclehistoryaction',
            },
            { actualLabel: 'User', nativeColumnToken: 'lifeCycleUserName' },
            {
              actualLabel: 'Date',
              nativeColumnToken: 'thePersistInfo_createStamp',
            },
          ],
        },
        {
          gridId: 'votingHistoryTableId',
          columns: [
            { actualLabel: '', nativeColumnToken: 'checker' },
            { actualLabel: 'Role', nativeColumnToken: 'roleName' },
            { actualLabel: 'Signer', nativeColumnToken: 'signerFullName' },
            { actualLabel: 'Vote', nativeColumnToken: 'lcVote' },
            { actualLabel: 'Comment', nativeColumnToken: 'comments' },
            {
              actualLabel: 'Date',
              nativeColumnToken: 'thePersistInfo_createStamp',
            },
          ],
        },
      ],
      sections: [
        {
          sectionId: 'BusinessAttributesGroup',
          label: 'Business',
          dataStoreId: 'dataStoreBusinessAttributesGroup',
          labels: [
            'SB/SL文档编号:',
            'SB/SL版本:',
            'OEM厂商类型:',
            'OEM厂商:',
            '类型:',
            'SB/SL标题:',
            '是否紧急:',
            '颁发日期:',
            '原创建者:',
            '原创建时间:',
          ],
        },
        {
          sectionId: 'MoreAttributesGroup',
          label: 'System',
          dataStoreId: 'dataStoreMoreAttributesGroup',
          labels: [
            'Description:',
            '',
            'Format Name:',
            'State:',
            'Context:',
            'Location:',
            'Life Cycle Template:',
            'Team Template:',
            'Created By:',
            'Modified By:',
            'Created On:',
            'Last Modified:',
          ],
        },
      ],
    },
  ],
});
// These exact fields alias components preserve observed references only. No row body or historical enumeration is certified.
export function createSbFieldsAliasValidator(model) {
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const exact = (v, keys) =>
    v &&
    typeof v === 'object' &&
    !Array.isArray(v) &&
    Object.keys(v).length === keys.length &&
    keys.every((k) => Object.hasOwn(v, k));
  const fail = () => {
    throw tdmsError('TDMS_COMPLETE_SB_FIELDS_ALIAS_PURPOSE_INVALID');
  };
  const ownerMatches = (scopeId, owner) =>
    ['SB', 'SL', 'SIL', 'SB-IN', 'MT'].includes(scopeId) &&
    owner?.scopeEvidence?.businessType === scopeId &&
    owner.nativeTypeId === 'WCTYPE|wt.doc.WTDocument|com.airchina.SBDocument' &&
    owner.nativeTypeEvidence?.state === 'VALUE' &&
    owner.nativeTypeEvidence.rawValue === owner.nativeTypeId &&
    owner.rawHeaderType === 'SB文档' &&
    /^(?:OR|VR):wt\.doc\.WTDocument:\d{1,24}$/u.test(
      owner.sourceRecordId || '',
    );
  function panel({ scopeId, owner, tab }) {
    return ownerMatches(scopeId, owner)
      ? model.panels.find(
          (p) =>
            p.tabId === tab?.tabId &&
            p.label === tab.label &&
            p.panelLocator === tab.panelLocator,
        ) || null
      : null;
  }
  function validate(e, { scopeId, owner, tab, read }) {
    const p = panel({ scopeId, owner, tab });
    if (
      !p ||
      !exact(e, [
        'schemaVersion',
        'modelRevision',
        'ownerSourceRecordId',
        'sourceVersion',
        'sourceModifiedRaw',
        'ownStateRaw',
        'sourceContext',
        'tabId',
        'panelLocator',
        'purpose',
        'bodyState',
        'enumerationState',
        'before',
        'after',
        'settledReads',
      ]) ||
      e.schemaVersion !== model.schemaVersion ||
      e.modelRevision !== model.modelRevision ||
      e.ownerSourceRecordId !== owner.sourceRecordId ||
      !same(e.sourceVersion, owner.sourceVersion) ||
      e.sourceModifiedRaw !== owner.sourceModifiedRaw ||
      e.ownStateRaw !== owner.stateRaw ||
      !same(e.sourceContext, read.sourceContext) ||
      e.tabId !== p.tabId ||
      e.panelLocator !== p.panelLocator ||
      e.purpose !== 'CANONICAL_FIELDS_AND_MANAGEMENT_REFERENCES' ||
      e.bodyState !== 'BOUND_TO_CANONICAL' ||
      e.enumerationState !== 'NOT_ENUMERATED' ||
      e.settledReads !== 2 ||
      !same(e.before, e.after)
    )
      fail();
    const f = e.before;
    if (
      !exact(f, [
        'activeTabId',
        'panelId',
        'visible',
        'componentIds',
        'grids',
        'fieldCount',
        'embeddedCount',
        'loading',
        'blockingMarkerCount',
        'rawReferences',
        'unknownSurfaceCount',
        'aliasFields',
        'sectionIds',
      ]) ||
      f.activeTabId !== p.tabId ||
      f.panelId !== p.panelLocator.slice(1) ||
      f.visible !== true ||
      !same(f.componentIds, p.componentIds) ||
      f.fieldCount !== 44 ||
      f.embeddedCount !== 0 ||
      f.loading !== false ||
      f.blockingMarkerCount !== 0 ||
      f.unknownSurfaceCount !== 0 ||
      !Array.isArray(f.grids) ||
      f.grids.length !== p.grids.length ||
      !Array.isArray(f.rawReferences) ||
      f.rawReferences.length > 10000
    )
      fail();
    for (const [i, g] of f.grids.entries()) {
      const m = p.grids[i];
      if (
        !exact(g, ['gridId', 'visible', 'columns', 'renderedRowCount']) ||
        g.gridId !== m.gridId ||
        g.visible !== true ||
        !same(g.columns, m.columns) ||
        !Number.isSafeInteger(g.renderedRowCount) ||
        g.renderedRowCount < 0 ||
        g.renderedRowCount > 10000
      )
        fail();
    }
    for (const r of f.rawReferences)
      if (
        !exact(r, ['locator', 'rawHref']) ||
        typeof r.locator !== 'string' ||
        !r.locator.startsWith(p.panelLocator + ' ') ||
        typeof r.rawHref !== 'string' ||
        r.rawHref.length > 20000
      )
        fail();
    if (
      !same(
        f.sectionIds,
        p.sections.map((s) => s.sectionId),
      ) ||
      !Array.isArray(f.aliasFields) ||
      f.aliasFields.length !== 22
    )
      fail();
    const expected = p.sections.flatMap((s) =>
      s.labels.map((label, ordinal) => ({
        sectionId: s.sectionId,
        dataStoreId: s.dataStoreId,
        label,
        ordinal,
      })),
    );
    for (const [index, slot] of expected.entries()) {
      const field = f.aliasFields[index],
        canonical = read.fields.filter(
          (x) =>
            x.tabId === model.canonicalTabId &&
            x.sectionId === model.canonicalTabId + '::' + slot.sectionId &&
            x.value.actualLabel === slot.label,
        );
      if (
        canonical.length !== 1 ||
        !exact(field, [
          'sectionId',
          'dataStoreId',
          'label',
          'ordinal',
          'canonicalFieldId',
          'state',
          'rawValue',
          'rawHrefs',
          ...(Object.hasOwn(field || {}, 'strictBlankEvidence')
            ? ['strictBlankEvidence']
            : []),
        ]) ||
        !Object.keys(slot).every((k) => field[k] === slot[k]) ||
        field.canonicalFieldId !== canonical[0].fieldId ||
        !Array.isArray(field.rawHrefs)
      )
        fail();
      const source = canonical[0],
        readable = ['VALUE', 'BLANK'].includes(source.value.state);
      if (
        field.state !== (readable ? source.value.state : 'NOT_READ') ||
        field.rawValue !== (readable ? source.value.rawValue : null) ||
        !same(
          field.rawHrefs,
          readable ? source.links.map((l) => l.rawHref) : [],
        )
      )
        fail();
      let strictBlank = false;
      if (Object.hasOwn(field, 'strictBlankEvidence')) {
        if (
          slot.label !== '' ||
          source.value.state !== 'BLANK' ||
          !source.strictBlankEvidence
        )
          fail();
        sbBlank.field(source.strictBlankEvidence, {
          scopeId,
          owner,
          read,
          field: source,
        });
        sbBlank.validate(field.strictBlankEvidence, {
          scopeId,
          owner,
          sourceContext: read.sourceContext,
          documentIdentity: read.domDocumentIdentity,
          fieldId: field.strictBlankEvidence.fieldId,
          canonicalFieldId: source.fieldId,
          tabId: tab.tabId,
          panelLocator: tab.panelLocator,
          use: 'ALIAS',
        });
        if (
          field.state !== 'BLANK' ||
          field.rawValue !== '' ||
          field.rawHrefs.length
        )
          fail();
        strictBlank = true;
      }
      if (slot.label === '' && source.strictBlankEvidence && !strictBlank)
        fail();
      if (
        slot.label === '' &&
        readable &&
        !strictBlank &&
        (!['Approved', '已批准', 'Estimated'].includes(owner.stateRaw) ||
          source.rawTextQualification?.ownStateRaw !== owner.stateRaw)
      )
        fail();
    }
    if (
      tab.required !== false ||
      tab.state !== 'NOT_READ' ||
      tab.reasonCode !== model.reasonCode
    )
      fail();
    for (const key of ['fields', 'sections', 'relationTables'])
      if (read[key]?.some((x) => x.tabId === p.tabId)) fail();
    return { complete: true, canonicalAlias: true, enumerationComplete: false };
  }
  return { panel, validate };
}
const validator = createSbFieldsAliasValidator(REVIEWED_SB_FIELDS_ALIAS_MODEL);
export const reviewedSbFieldsAliasPanel = validator.panel;
export const validateReviewedSbFieldsAliasPurpose = validator.validate;
