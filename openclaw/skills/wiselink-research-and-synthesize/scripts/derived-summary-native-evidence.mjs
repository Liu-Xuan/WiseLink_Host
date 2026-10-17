import { canonicalJson } from './validate-payload.mjs';
import { sameTdmsNativeEvidenceBody } from './tdms-native-context.mjs';

const fail = () => { throw new Error('DERIVED_SUMMARY_NATIVE_RECEIPT_INVALID'); };
const failDocumentCarrier = () => { throw new Error('DERIVED_SUMMARY_DOCUMENT_CARRIER_INVALID'); };

// Same canonical SourceRef forms as Host stableJobAidEvidence. SourceRef itself
// may contain colons; only the DVI prefix and complete SourceRef suffix bind it.
function canonicalDocumentSource(item) {
  if (item?.kind !== 'DOCUMENT_PASSAGE' || typeof item.documentVersionId !== 'string' ||
      !item.documentVersionId || typeof item.sourceRefId !== 'string' || !item.sourceRefId ||
      typeof item.evidenceRef !== 'string' ||
      !(item.workItemId === null || typeof item.workItemId === 'string' && item.workItemId.trim())) return false;
  if (item.evidenceRef === `source:${item.documentVersionId}:${item.sourceRefId}`) return true;
  const prefix = `DOCUMENT_ORIGINAL:${item.documentVersionId}:`, suffix = `:${item.sourceRefId}`;
  return item.evidenceRef.startsWith(prefix) && item.evidenceRef.endsWith(suffix) &&
    /^[A-Za-z0-9_-]{1,96}$/u.test(item.evidenceRef.slice(prefix.length, -suffix.length));
}

export function sameSummaryEvidence(left, right) {
  if (canonicalDocumentSource(left) && canonicalDocumentSource(right)) {
    const { workItemId: _leftWorkItemId, ...leftSource } = left;
    const { workItemId: _rightWorkItemId, ...rightSource } = right;
    return canonicalJson(leftSource) === canonicalJson(rightSource);
  }
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
export function summaryNativeReceiptFields(evidence, registry) {
  const nativeReadReceipts = collectSummaryNativeReadReceipts(evidence);
  const first = registry ?? new Map();
  if (!registry) for (const item of evidence) if (!first.has(item.evidenceRef)) first.set(item.evidenceRef, item);
  const changed = new Set(), counts = new Map();
  for (const item of evidence) {
    if (!canonicalDocumentSource(item)) continue;
    const body = first.get(item.evidenceRef);
    if (!sameSummaryEvidence(body, item)) failDocumentCarrier();
    const count = (counts.get(item.evidenceRef) ?? 0) + 1;
    counts.set(item.evidenceRef, count);
    if (count > 1 || body.workItemId !== item.workItemId) changed.add(item.evidenceRef);
  }
  const documentWorkItemCarriers = evidence.filter(item => canonicalDocumentSource(item) && changed.has(item.evidenceRef))
    .map(item => ({ evidenceRef: item.evidenceRef, workItemId: item.workItemId }));
  return { ...(nativeReadReceipts.length ? { nativeReadReceipts } : {}),
    ...(documentWorkItemCarriers.length ? { documentWorkItemCarriers } : {}) };
}

/** Reconstruct each exact saved member's historical carrier from the shared body
 * plus its separate receipt. Never substitute the registry member's receipt. */
export function summaryEvidenceRefs(evidence) {
  const refs = evidence.map(item => item.evidenceRef);
  if (!evidence.some(item => item.kind === 'TDMS_NATIVE_RECORD')) return refs;
  const seen = new Set();
  return evidence.flatMap(item => {
    const keep = canonicalDocumentSource(item) || !seen.has(item.evidenceRef);
    seen.add(item.evidenceRef);
    return keep ? [item.evidenceRef] : [];
  });
}
export function restoreSummaryMemberEvidence(projected, registry) {
  let evidence = projected.evidenceRefs.map(ref => structuredClone(registry.get(ref)?.value));
  if (evidence.some(item => !item)) fail();
  const documentRows = new Map();
  if (projected.documentWorkItemCarriers !== undefined) {
    if (!Array.isArray(projected.documentWorkItemCarriers) || !projected.documentWorkItemCarriers.length)
      failDocumentCarrier();
    for (const row of projected.documentWorkItemCarriers) {
      if (!row || typeof row !== 'object' || Array.isArray(row) ||
          Object.keys(row).sort().join(',') !== 'evidenceRef,workItemId' ||
          !projected.evidenceRefs.includes(row.evidenceRef) || !canonicalDocumentSource(registry.get(row.evidenceRef)?.value) ||
          !(row.workItemId === null || typeof row.workItemId === 'string' && row.workItemId.trim())) failDocumentCarrier();
      const rows = documentRows.get(row.evidenceRef) ?? [];
      rows.push(row);documentRows.set(row.evidenceRef, rows);
    }
  }
  const refCounts = new Map();
  for (const ref of projected.evidenceRefs) refCounts.set(ref, (refCounts.get(ref) ?? 0) + 1);
  for (const item of evidence) {
    if (!canonicalDocumentSource(item)) continue;
    const count = refCounts.get(item.evidenceRef);
    if (documentRows.has(item.evidenceRef) ? documentRows.get(item.evidenceRef).length !== count : count > 1)
      failDocumentCarrier();
  }
  if (projected.documentWorkItemCarriers !== undefined &&
      canonicalJson(projected.documentWorkItemCarriers.map(row => row.evidenceRef)) !==
      canonicalJson(projected.evidenceRefs.filter(ref => documentRows.has(ref)))) failDocumentCarrier();
  const positions = new Map();
  evidence = evidence.map(item => {
    const rows = documentRows.get(item.evidenceRef);
    if (!rows) return item;
    const index = positions.get(item.evidenceRef) ?? 0;
    positions.set(item.evidenceRef, index + 1);
    const carrier = { ...item, workItemId: rows[index].workItemId };
    if (!sameSummaryEvidence(item, carrier)) failDocumentCarrier();
    return carrier;
  });
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
  const fields = summaryNativeReceiptFields(value.evidence);
  if (!fields.nativeReadReceipts && !fields.documentWorkItemCarriers) return structuredClone(value);
  const evidence = new Map();
  for (const item of value.evidence) {
    const previous = evidence.get(item.evidenceRef);
    if (previous && !sameSummaryEvidence(previous, item)) fail();
    if (!previous) evidence.set(item.evidenceRef, structuredClone(item));
  }
  return {...structuredClone(value), evidence: [...evidence.values()], ...fields};
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
