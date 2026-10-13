import { tdmsError } from './tdms-source.types';
// Business meaning was confirmed by the human: AEO's R-number comes from
// its own EO编号 suffix. The hidden development sample never certifies a read.
export const REVIEWED_AEO_BUSINESS_NUMBER_MODEL = Object.freeze({
  modelRevision: 'tdms-reviewed-aeo-own-number-business-version@1',
  scopeId: 'AEO',
  nativeTypeId:
    'WCTYPE|wt.epm.EPMDocument|com.airchina.DynamicDocument|com.airchina.EODocument',
  rawHeaderType: 'Publication Source',
  actualLabel: 'EO编号:',
  revisionPattern: 'R[0-9]{1,6}',
  nativeInputSha256:
    'c1fddccbe6c4c52ce802200eabb9a748fa8fbcef0c9ea0f49bca9a423af8fdba',
  semanticAuthority:
    'HUMAN_CONFIRMED_AEO_BUSINESS_REVISION_FROM_OWN_EO_NUMBER_SUFFIX',
});
const invalid = () => {
  throw tdmsError('TDMS_AEO_OWN_BUSINESS_NUMBER_INVALID');
};
export function isReviewedAeoBusinessNumberHeader({
  scopeId,
  sourceRecordId,
  nativeTypeId,
  rawHeaderType,
  engineeringSubtype,
} = {}) {
  const m = REVIEWED_AEO_BUSINESS_NUMBER_MODEL;
  return (
    scopeId === m.scopeId &&
    /^(?:OR|VR):wt\.epm\.EPMDocument:\d{1,24}$/u.test(sourceRecordId || '') &&
    nativeTypeId === m.nativeTypeId &&
    rawHeaderType === m.rawHeaderType &&
    engineeringSubtype === m.scopeId
  );
}
export function isReviewedAeoBusinessNumberOwner({ scopeId, owner } = {}) {
  return (
    isReviewedAeoBusinessNumberHeader({
      scopeId,
      sourceRecordId: owner?.sourceRecordId,
      nativeTypeId: owner?.nativeTypeId,
      rawHeaderType: owner?.rawHeaderType,
      engineeringSubtype: owner?.scopeEvidence?.engineeringSubtype,
    }) &&
    owner?.nativeTypeEvidence?.state === 'VALUE' &&
    owner.nativeTypeEvidence.rawValue === owner.nativeTypeId &&
    owner.sourceVersion?.confirmation === 'SOURCE_DECLARED'
  );
}
export function parseReviewedAeoOwnBusinessNumber({
  scopeId,
  owner,
  value,
} = {}) {
  if (!isReviewedAeoBusinessNumberOwner({ scopeId, owner })) return false;
  if (
    value?.state !== 'VALUE' ||
    value.actualLabel !== REVIEWED_AEO_BUSINESS_NUMBER_MODEL.actualLabel ||
    typeof value.rawValue !== 'string' ||
    typeof owner.number !== 'string' ||
    !owner.number ||
    typeof value.locator !== 'string' ||
    !/(?:^|\s)#dataStorePrimary_Attributes(?=\s|$)/u.test(value.locator)
  )
    invalid();
  const raw = value.rawValue.trim(),
    prefix = owner.number + '-';
  if (
    !raw.startsWith(prefix) ||
    !/^R[0-9]{1,6}$/u.test(raw.slice(prefix.length))
  )
    invalid();
  return {
    rawRevision: raw.slice(prefix.length),
    rawIteration: null,
    confirmation: 'SOURCE_DECLARED',
  };
}
// Independent raw field link: a table Document Number or matching filename
// cannot stand in for this source-native own attribute occurrence.
export function validateReviewedAeoBusinessNumberEvidence({
  scopeId,
  owner,
  fields,
} = {}) {
  const v = owner?.businessVersionEvidence,
    m = REVIEWED_AEO_BUSINESS_NUMBER_MODEL;
  if (v?.actualLabel !== m.actualLabel) return false;
  const parsed = parseReviewedAeoOwnBusinessNumber({
    scopeId,
    owner,
    value: v,
  });
  if (
    !parsed ||
    owner.businessVersion?.rawRevision !== parsed.rawRevision ||
    owner.businessVersion.rawIteration !== null ||
    owner.businessVersion.confirmation !== 'SOURCE_DECLARED' ||
    !Array.isArray(fields)
  )
    invalid();
  const linked = fields.filter((f) => f?.value?.actualLabel === m.actualLabel);
  if (linked.length !== 1 || linked[0].value.locator !== v.locator) invalid();
  const f = linked[0];
  if (
    f.labelOrigin !== 'NATIVE_SOURCE_DECLARED' ||
    f.nativeControl?.tag !== 'TD' ||
    typeof f.tabId !== 'string' ||
    !f.tabId.startsWith('infoPageinfoPanelID__') ||
    f.tabId.includes('latestStatusLink') ||
    f.sectionId !== f.tabId + '::Primary_Attributes' ||
    f.fieldId !== v.locator ||
    !/(?:^|\s)#dataStorePrimary_Attributes(?=\s|$)/u.test(v.locator) ||
    Object.keys(f.value).length !== Object.keys(v).length ||
    Object.keys(v).some(
      (k) => !Object.hasOwn(f.value, k) || f.value[k] !== v[k],
    )
  )
    invalid();
  return true;
}
