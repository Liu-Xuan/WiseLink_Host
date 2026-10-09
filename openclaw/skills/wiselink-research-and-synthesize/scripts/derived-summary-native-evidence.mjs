import { canonicalJson } from './validate-payload.mjs';
import { sameTdmsNativeEvidenceBody } from './tdms-native-context.mjs';

const fail = () => { throw new Error('DERIVED_SUMMARY_NATIVE_RECEIPT_INVALID'); };
export function sameSummaryEvidence(left, right) {
  if (left?.kind !== 'TDMS_NATIVE_RECORD' || right?.kind !== 'TDMS_NATIVE_RECORD')
    return canonicalJson(left) === canonicalJson(right);
  collectSummaryNativeReadReceipts([left, right]);
  if (!sameTdmsNativeEvidenceBody(left, right)) return false;
  if (left.nativeReadReceipt.receiptRef === right.nativeReadReceipt.receiptRef &&
      canonicalJson(left.nativeReadReceipt) !== canonicalJson(right.nativeReadReceipt)) fail();
  return true;
}

/** Retained provenance only: neither an ACL grant nor proof of fresh model memory. */
export function collectSummaryNativeReadReceipts(evidence) {
  const receipts = new Map();
  for (const item of evidence) {
    if (item?.kind !== 'TDMS_NATIVE_RECORD') continue;
    const receipt = item.nativeReadReceipt;
    if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt) ||
        Object.keys(receipt).sort().join(',') !== ['receiptRef','sourceRevisionRef','readAt','purpose','fieldPaths','taskContextRef','readPerformed','permissionRevision','engineeringAdoption','executionVerified'].sort().join(',') ||
        ['receiptRef','sourceRevisionRef','taskContextRef','permissionRevision'].some(key => typeof receipt[key] !== 'string' || !receipt[key].trim()) ||
        typeof receipt.readAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/u.test(receipt.readAt) || !Number.isFinite(Date.parse(receipt.readAt)) ||
        new Date(`${receipt.readAt.slice(0,10)}T00:00:00.000Z`).toISOString().slice(0,10) !== receipt.readAt.slice(0,10)) fail();
    sameTdmsNativeEvidenceBody(item, item); // Structural transport validation only.
    const value = { evidenceRef: item.evidenceRef, receipt: structuredClone(item.nativeReadReceipt) };
    const old = receipts.get(value.receipt.receiptRef);
    if (old && canonicalJson(old) !== canonicalJson(value)) fail();
    receipts.set(value.receipt.receiptRef, value);
  }
  return [...receipts.values()];
}
export function summaryNativeReceiptFields(evidence) {
  const nativeReadReceipts = collectSummaryNativeReadReceipts(evidence);
  return nativeReadReceipts.length ? { nativeReadReceipts } : {};
}

/** Reconstruct each exact saved member's historical carrier from the shared body
 * plus its separate receipt. Never substitute the registry member's receipt. */
export function summaryEvidenceRefs(evidence) {
  const refs = evidence.map(item => item.evidenceRef);
  return evidence.some(item => item.kind === 'TDMS_NATIVE_RECORD') ? [...new Set(refs)] : refs;
}
export function restoreSummaryMemberEvidence(projected, registry) {
  const evidence = projected.evidenceRefs.map(ref => structuredClone(registry.get(ref)?.value));
  if (evidence.some(item => !item)) fail();
  const native = evidence.filter(item => item.kind === 'TDMS_NATIVE_RECORD');
  if (!native.length) {
    if (projected.nativeReadReceipts !== undefined) fail();
    return evidence;
  }
  if (!Array.isArray(projected.nativeReadReceipts) || !projected.nativeReadReceipts.length ||
      projected.nativeReadReceipts.some(value => !native.some(item => item.evidenceRef === value?.evidenceRef))) fail();
  const restored = evidence.flatMap(item => {
    if (item.kind !== 'TDMS_NATIVE_RECORD') return [item];
    const rows = projected.nativeReadReceipts.filter(value => value?.evidenceRef === item.evidenceRef);
    if (!rows.length) fail();
    return rows.map(row => {
      if (Object.keys(row).sort().join(',') !== 'evidenceRef,receipt') fail();
      const carrier = { ...item, nativeReadReceipt: structuredClone(row.receipt) };
      if (!sameSummaryEvidence(item, carrier)) fail();
      return carrier;
    });
  });
  if (collectSummaryNativeReadReceipts(restored).length !== projected.nativeReadReceipts.length) fail();
  return restored;
}

/** Detached full-member delivery keeps one exact native body plus every receipt. */
export function projectSummaryMemberNativeContent(value) {
  if (!value.evidence.some(item => item.kind === 'TDMS_NATIVE_RECORD')) return structuredClone(value);
  const evidence = new Map();
  for (const item of value.evidence) {
    const previous = evidence.get(item.evidenceRef);
    if (previous && !sameSummaryEvidence(previous, item)) fail();
    if (!previous) evidence.set(item.evidenceRef, structuredClone(item));
  }
  return {...structuredClone(value), evidence: [...evidence.values()], ...summaryNativeReceiptFields(value.evidence)};
}

/** Validate the complete batch before the caller mutates any delivery state. */
export function checkSummaryNativeReceiptHistory(evidence, delivered) {
  const incoming = collectSummaryNativeReadReceipts(evidence);
  for (const value of incoming) {
    const old = delivered.nativeReadReceipts?.get(value.receipt.receiptRef);
    if (old && canonicalJson(old) !== canonicalJson(value)) fail();
  }
  return () => {
    if (!incoming.length) return;
    delivered.nativeReadReceipts ??= new Map();
    for (const value of incoming) delivered.nativeReadReceipts.set(value.receipt.receiptRef, value);
  };
}
