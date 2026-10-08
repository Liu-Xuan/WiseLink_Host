import { sameSummaryEvidence, summaryNativeReceiptFields, summaryEvidenceRefs, projectSummaryMemberNativeContent, restoreSummaryMemberEvidence, checkSummaryNativeReceiptHistory } from './derived-summary-native-evidence.mjs';
import { canonicalJson } from './validate-payload.mjs';
import { assertSummaryExactKeys, completeDerivedSummaryWorkBody, validateDerivedSummaryReading,
  validateDerivedSummaryReadSelection } from './derived-summary-shape.mjs';

const fail = () => { throw new Error('DERIVED_SUMMARY_READ_PROJECTION_BINDING_INVALID'); };
const memberContent = ({ current, overviewStatus, limitations, ...content }) => content;
const nativeReceiptProjection = (evidence, messageIndex, pointer) => {
  const fields = summaryNativeReceiptFields(evidence);
  return fields.nativeReadReceipts ? { ...fields,
    nativeReadReceiptLocations: fields.nativeReadReceipts.map((value, index) => ({ evidenceRef: value.evidenceRef,
      messageIndex, toolPointer: `${pointer}/nativeReadReceipts/${index}/receipt` })) } : fields;
};

/** The current Host contract has no partial/error envelope. Never normalize one
 * into a successful read just because its payload happens to have enough rows. */
export function assertDerivedSummaryReadReceiptShape(receipt, operation) {
  const field = operation === 'READ_MEMBER_WORK' ? 'members' : operation === 'READ_SOURCES' ? 'evidence' : null;
  if (!field) fail();
  assertSummaryExactKeys(receipt, [field], 'DERIVED_SUMMARY_READ_PROJECTION_BINDING_INVALID');
  if (!Array.isArray(receipt[field])) fail();
  return field;
}

/** Track only full content actually present in this initial model view. The
 * registry is intentionally not an argument. Locations address JSON within the
 * saved INPUT string. Missing evidenceRefs are not promoted to full delivery. */
export function createDerivedSummaryDeliveredView(view) {
  const delivered = { members: new Map(), evidence: new Map() };
  for (const [index, value] of (view.evidence ?? []).entries()) {
    if (typeof value?.evidenceRef !== 'string' || delivered.evidence.has(value.evidenceRef)) fail();
    delivered.evidence.set(value.evidenceRef, { value: structuredClone(value),
      location: { messageIndex: 1, inputPointer: `/evidence/${index}` } });
  }
  for (const [index, projected] of (view.members ?? []).entries()) {
    const { evidenceRefs, nativeReadReceipts: _nativeReadReceipts, ...member } = projected;
    if (!Array.isArray(evidenceRefs) || evidenceRefs.some(ref => !delivered.evidence.has(ref))) continue;
    const reading = { ...member, evidence: restoreSummaryMemberEvidence(projected, delivered.evidence) };
    if (Object.hasOwn(member, 'understanding'))
      reading.body = completeDerivedSummaryWorkBody(member.understanding, member.issues);
    validateDerivedSummaryReading(reading);
    if (delivered.members.has(reading.evidenceRef)) fail();
    delivered.members.set(reading.evidenceRef, { value: structuredClone(reading),
      location: { messageIndex: 1, inputPointer: `/members/${index}`,
        contentFields: Object.hasOwn(member, 'understanding') ? ['understanding', 'issues'] : ['body', 'issues'],
        evidenceLocations: evidenceRefs.map(ref => ({ evidenceRef: ref, ...delivered.evidence.get(ref).location })),
        ...(projected.nativeReadReceipts ? { nativeReadReceiptLocations: projected.nativeReadReceipts.map((value, receiptIndex) => ({ evidenceRef: value.evidenceRef, messageIndex: 1, inputPointer: `/members/${index}/nativeReadReceipts/${receiptIndex}/receipt` })) } : {}) } });
  }
  checkSummaryNativeReceiptHistory([...delivered.evidence.values(), ...delivered.members.values()].flatMap(item => item.value.evidence ?? [item.value]), delivered)();
  return delivered;
}

/** Full immutable receipt remains elsewhere. This detached working view only
 * confirms a same exact ref after content, selection and receipt binding checks.
 * Fresh notices do not establish approval, applicability or fresh source truth. */
export function projectDerivedSummaryReadReceipt(receipt, intent, registry, delivered, { round, messageIndex }) {
  validateDerivedSummaryReadSelection(intent, registry, intent.action);
  const field = assertDerivedSummaryReadReceiptShape(receipt, intent.action);
  const values = receipt[field];
  if (!Number.isSafeInteger(round) || round < 0 || !Number.isSafeInteger(messageIndex) || messageIndex < 3 ||
      values.length !== intent.evidenceRefs.length || new Set(values.map(value => value?.evidenceRef)).size !== values.length)
    fail();
  const target = field === 'members' ? delivered.members : delivered.evidence;
  const allowed = field === 'members' ? registry.members : registry.evidence;
  // Validate the whole receipt before adding any successful delivery.
  for (const value of values) {
    if (!intent.evidenceRefs.includes(value?.evidenceRef) || !allowed.has(value.evidenceRef)) fail();
    if (field === 'members') {
      validateDerivedSummaryReading(value);
      for (const evidence of value.evidence) {
        const prior = delivered.evidence.get(evidence.evidenceRef);
        if (prior && !sameSummaryEvidence(prior.value, evidence)) fail();
      }
    }
    const content = field === 'members' ? memberContent(value) : value;
    const expected = field === 'members' ? memberContent(allowed.get(value.evidenceRef)) : allowed.get(value.evidenceRef);
    if (field === 'members' ? canonicalJson(content) !== canonicalJson(expected) : !sameSummaryEvidence(content, expected)) fail();
    const previous = target.get(value.evidenceRef);
    if (previous && (field === 'members' ? canonicalJson(memberContent(previous.value)) !== canonicalJson(content) : !sameSummaryEvidence(previous.value, content))) fail();
  }
  const retainNativeReceipts = checkSummaryNativeReceiptHistory(values.flatMap(value => field === 'members' ? value.evidence : [value]), delivered);
  retainNativeReceipts();
  const items = values.map((value, index) => {
    const previous = target.get(value.evidenceRef);
    const notices = field === 'members'
      ? { current: value.current, overviewStatus: value.overviewStatus, limitations: structuredClone(value.limitations) }
      : { inheritedSourceReadIsNotFreshVerification: true };
    const nativeReceipts = nativeReceiptProjection(field === 'members' ? value.evidence : [value], messageIndex, `/items/${index}`);
    if (previous) return { evidenceRef: value.evidenceRef, status: 'CONFIRMED_SAME_CONTENT',
      contentLocation: structuredClone(previous.location), notices, ...nativeReceipts };
    const content = field === 'members' ? projectSummaryMemberNativeContent(value) : structuredClone(value);
    const location = { messageIndex, toolPointer: `/items/${index}/content`,
      ...(content.nativeReadReceipts ? { nativeReadReceiptLocations: nativeReceiptProjection(value.evidence, messageIndex,
        `/items/${index}/content`).nativeReadReceiptLocations } : {}),
      ...(content.kind === 'TDMS_NATIVE_RECORD' ? { nativeReadReceiptLocations: [{ evidenceRef: content.evidenceRef,
        messageIndex, toolPointer: `/items/${index}/content/nativeReadReceipt` }] } : {}) };
    target.set(value.evidenceRef, { value: structuredClone(value), location });
    if (field === 'members') {
      // Locations follow content actually emitted after native body deduplication.
      content.evidence.forEach((evidence, evidenceIndex) => {
        const prior = delivered.evidence.get(evidence.evidenceRef);
        if (!prior) delivered.evidence.set(evidence.evidenceRef, { value: structuredClone(evidence),
          location: { messageIndex, toolPointer: `/items/${index}/content/evidence/${evidenceIndex}` } });
      });
    }
    return { evidenceRef: value.evidenceRef, status: 'DELIVERED_FULL_CONTENT', contentLocation: location,
      content, notices, ...nativeReceipts };
  });
  return { operation: intent.action, requestedEvidenceRefs: [...intent.evidenceRefs],
    receiptCheckpointKey: `summary-round-${round}-read`, status: 'READ_COMPLETE',
    notice: 'Host authorized this exact read and checked the bound versions. Same-content confirmations refer to full content already in these messages. This does not establish approval, applicability, or fresh verification of inherited sources.',
    items };
}
