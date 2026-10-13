// Pure contract from frozen TDMS 0.2.54; no runtime or source authority.
// Browser document replacement evidence, kept out of semantic content hashes.
// Capture timestamps alone never prove a fresh native source load.
export const NATIVE_RELOAD_SCHEMA = 'wiselink.tdms-native-document-reload.v1';
const keys = Object.freeze([
  'schemaVersion',
  'sourceRecordId',
  'beforeDocumentIdentity',
  'documentIdentity',
  'trigger',
  'cacheMode',
  'frameId',
  'settledReads',
  'requestedAt',
  'settledAt',
]);
const text = (v) =>
  typeof v === 'string' && v.trim().length > 0 && v.length <= 250;
const time = (v) =>
  typeof v === 'string' &&
  /^\d{4}-\d{2}-\d{2}T/u.test(v) &&
  Number.isFinite(Date.parse(v));
export function isNativeReloadProvenance(
  raw,
  { sourceRecordId, documentIdentity, observedAt = null } = {},
) {
  if (
    !raw ||
    typeof raw !== 'object' ||
    Array.isArray(raw) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(raw)) ||
    Reflect.ownKeys(raw).length !== keys.length ||
    !keys.every((k) =>
      Object.hasOwn(Object.getOwnPropertyDescriptor(raw, k) || {}, 'value'),
    )
  )
    return false;
  return (
    raw.schemaVersion === NATIVE_RELOAD_SCHEMA &&
    raw.sourceRecordId === sourceRecordId &&
    text(raw.beforeDocumentIdentity) &&
    text(raw.documentIdentity) &&
    raw.beforeDocumentIdentity !== raw.documentIdentity &&
    raw.documentIdentity === documentIdentity &&
    raw.trigger === 'CHROME_TABS_RELOAD' &&
    raw.cacheMode === 'BYPASS_CACHE' &&
    raw.frameId === 0 &&
    raw.settledReads === 2 &&
    time(raw.requestedAt) &&
    time(raw.settledAt) &&
    Date.parse(raw.requestedAt) <= Date.parse(raw.settledAt) &&
    (observedAt === null ||
      (time(observedAt) && Date.parse(raw.settledAt) <= Date.parse(observedAt)))
  );
}
