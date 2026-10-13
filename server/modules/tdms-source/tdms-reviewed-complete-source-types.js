// Pure EFRequest surface contract from the SHA-qualified 2026-10-14 code delta.
// Native fields describe observations; they do not supply source authority.
import { tdmsError } from './tdms-source.types';

export const EFREQUEST_READONLY_MODEL_REVISION =
  'tdms-reviewed-efrequest-readonly-surfaces@1';
export const REVIEWED_EFREQUEST_NATIVE_MODEL = Object.freeze({
  modelRevision: EFREQUEST_READONLY_MODEL_REVISION,
  scopeId: 'ENGINEERING_ASSESSMENT',
  nativeClass: 'wt.doc.WTDocument',
  nativeTypeId: 'WCTYPE|wt.doc.WTDocument|com.airchina.EFRequest',
  nativeHeaderType: '工程文件编写评估单',
  detailTabId:
    'infoPageinfoPanelID__infoPage_myTab_object_docInfoDefaultDetails',
  detailPanel: '#infoPage_myTab_object_docInfoDefaultDetails',
  rootLocator: '#infoPagemainInfoPagePanel',
  technicalVersion: Object.freeze({
    source: 'OWN_HEADER_THIRD_SLOT',
    locator: '#infoPageIdentityObjectIdentifier',
  }),
  modifiedMirrors: Object.freeze(['General', 'MoreAttributesGroup']),
  nonContentControl: Object.freeze({
    actionId: 'infoPageinfoPanelID__new_tab_action',
    tag: 'LI',
    classToken: 'x-tab-with-icon',
    rawCaption: '',
    semantic: 'NATIVE_TAB_CREATE_ACTION',
  }),
});
const own = (v, k) => Object.hasOwn(v || {}, k);
const exactKeys = (v, keys) =>
  v &&
  typeof v === 'object' &&
  !Array.isArray(v) &&
  Object.keys(v).length === keys.length &&
  keys.every((k) => own(v, k));
const nativeRef = /^(?:OR|VR):wt\.doc\.WTDocument:\d{1,24}$/u;
const reject = () => {
  throw tdmsError('TDMS_REVIEWED_COMPLETE_TAB_ROSTER_INVALID');
};

export function isReviewedEfRequestHeader({
  scopeId,
  sourceRecordId,
  nativeTypeId,
  rawHeaderType,
} = {}) {
  const m = REVIEWED_EFREQUEST_NATIVE_MODEL;
  return (
    scopeId === m.scopeId &&
    nativeRef.test(sourceRecordId || '') &&
    nativeTypeId === m.nativeTypeId &&
    rawHeaderType === m.nativeHeaderType
  );
}
export function isReviewedEfRequestOwner({ scopeId, owner } = {}) {
  return (
    isReviewedEfRequestHeader({
      scopeId,
      sourceRecordId: owner?.sourceRecordId,
      nativeTypeId: owner?.nativeTypeId,
      rawHeaderType: owner?.rawHeaderType,
    }) &&
    owner?.nativeTypeEvidence?.state === 'VALUE' &&
    owner.nativeTypeEvidence.rawValue === owner.nativeTypeId
  );
}

export function validateReviewedCompleteTabRoster({
  scopeId,
  owner,
  rosterEvidence,
  contentTabIds,
} = {}) {
  const hasStrip = own(rosterEvidence, 'nativeTabStripIds');
  const hasControls = own(rosterEvidence, 'nonContentControls');
  if (!hasStrip && !hasControls) return false;
  if (
    !hasStrip ||
    !hasControls ||
    !isReviewedEfRequestOwner({ scopeId, owner })
  )
    reject();
  const strip = rosterEvidence.nativeTabStripIds;
  const controls = rosterEvidence.nonContentControls;
  const ids = (v) =>
    Array.isArray(v) &&
    v.length > 0 &&
    v.length <= 100 &&
    v.every(
      (id) =>
        typeof id === 'string' &&
        id.length <= 200 &&
        /^infoPageinfoPanelID__/u.test(id),
    ) &&
    new Set(v).size === v.length;
  if (
    !ids(strip) ||
    !ids(contentTabIds) ||
    !Array.isArray(controls) ||
    controls.length !== 1 ||
    JSON.stringify(rosterEvidence.tabIds) !== JSON.stringify(contentTabIds)
  )
    reject();
  const c = controls[0];
  const m = REVIEWED_EFREQUEST_NATIVE_MODEL;
  const a = m.nonContentControl;
  if (
    !exactKeys(c, [
      'actionId',
      'tag',
      'rawClassName',
      'rawCaption',
      'locator',
      'rootLocator',
      'semantic',
      'modelRevision',
    ]) ||
    c.actionId !== a.actionId ||
    c.tag !== a.tag ||
    typeof c.rawClassName !== 'string' ||
    JSON.stringify(c.rawClassName.split(/\s+/u).filter(Boolean)) !==
      JSON.stringify([a.classToken]) ||
    c.rawCaption !== a.rawCaption ||
    c.locator !== '#' + a.actionId ||
    c.rootLocator !== m.rootLocator ||
    c.semantic !== a.semantic ||
    c.modelRevision !== m.modelRevision
  )
    reject();
  if (
    strip.at(-1) !== a.actionId ||
    contentTabIds.includes(a.actionId) ||
    JSON.stringify(strip.filter((id) => id !== a.actionId)) !==
      JSON.stringify(contentTabIds)
  )
    reject();
  return true;
}

export function isReviewedEfRequestUnknownFieldCaption({
  scopeId,
  owner,
  field,
} = {}) {
  const v = field?.value;
  const m = REVIEWED_EFREQUEST_NATIVE_MODEL;
  return (
    isReviewedEfRequestOwner({ scopeId, owner }) &&
    field?.labelOrigin === 'NATIVE_SOURCE_DECLARED' &&
    field.tabId === m.detailTabId &&
    field.sectionId === m.detailTabId + '::MoreAttributesGroup' &&
    field.nativeControl?.tag === 'TD' &&
    v?.actualLabel === '' &&
    v.state === 'NOT_READ' &&
    v.rawValue === null &&
    v.observedTotalCodepoints === 0 &&
    v.locator === field.fieldId &&
    typeof v.locator === 'string' &&
    v.locator.startsWith(m.detailPanel + ' ') &&
    Array.isArray(field.links) &&
    field.links.length === 0
  );
}

export function validateReviewedEfRequestModifiedMirrors({
  scopeId,
  owner,
  fields,
} = {}) {
  if (!isReviewedEfRequestOwner({ scopeId, owner })) return false;
  const m = REVIEWED_EFREQUEST_NATIVE_MODEL;
  const rows = Array.isArray(fields)
    ? fields.filter((f) => f?.value?.actualLabel === 'Last Modified:')
    : [];
  if (
    rows.length !== 2 ||
    m.modifiedMirrors.some((section, index) => {
      const f = rows[index];
      return (
        f.tabId !== m.detailTabId ||
        f.sectionId !== m.detailTabId + '::' + section ||
        f.labelOrigin !== 'NATIVE_SOURCE_DECLARED' ||
        f.nativeControl?.tag !== 'TD' ||
        f.fieldId !== f.value.locator
      );
    })
  )
    throw tdmsError('TDMS_COMPLETE_OWN_MODIFIED_MIRROR_INVALID');
  const readable = rows.filter((f) => f.value.state === 'VALUE');
  const unread = rows.filter((f) =>
    ['NOT_READ', 'NOT_LOADED', 'ACCESS_DENIED'].includes(f.value.state),
  );
  if (!readable.length)
    throw tdmsError('TDMS_COMPLETE_OWN_MODIFIED_MIRROR_UNREAD');
  if (
    readable.length + unread.length !== rows.length ||
    readable.some((f) => f.value.rawValue !== owner.sourceModifiedRaw)
  )
    throw tdmsError('TDMS_COMPLETE_OWN_MODIFIED_MIRROR_CHANGED');
  return {
    state: unread.length ? 'NOT_READ' : 'VALUE',
    unreadLocators: unread.map((f) => f.value.locator),
  };
}
