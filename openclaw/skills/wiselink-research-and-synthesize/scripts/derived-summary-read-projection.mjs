import { sameSummaryEvidence, summaryNativeReceiptFields, summaryEvidenceRefs, projectSummaryMemberNativeContent, restoreSummaryMemberEvidence, checkSummaryNativeReceiptHistory } from './derived-summary-native-evidence.mjs';
import { derivedSummarySparseMemberBody } from './derived-summary-incremental-revision.mjs';
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
    const { evidenceRefs, nativeReadReceipts: _nativeReadReceipts,
      documentWorkItemCarriers: _documentWorkItemCarriers, ...member } = projected;
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

/** Sparse v1 has independent own-body and source-body ledgers. Reconstruct only
 * an own-body Reading for shape checks; refs do not supply or deliver sources. */
export function createDerivedSummarySparseDeliveredView(view, registry) {
  const delivered = { members: new Map(), evidence: new Map() };
  if (!registry?.members || !registry?.evidence || !Array.isArray(view.members) ||
      !Array.isArray(view.evidence) || !Array.isArray(view.membersDirectory)) fail();
  const restorationRegistry = new Map([...registry.evidence].map(([ref, value]) => [ref, { value }]));
  const carriers = [];
  // Validate directory receipt metadata, without promoting it to body delivery.
  for (const directory of view.membersDirectory) {
    if (!registry.members.has(directory?.evidenceRef)) fail();
    carriers.push(...restoreSummaryMemberEvidence(directory, restorationRegistry));
  }
  for (const [index, value] of view.evidence.entries()) {
    if (!registry.evidence.has(value?.evidenceRef) || delivered.evidence.has(value.evidenceRef) ||
        !sameSummaryEvidence(value, registry.evidence.get(value.evidenceRef))) fail();
    carriers.push(value);
    delivered.evidence.set(value.evidenceRef, { value: structuredClone(value),
      location: { messageIndex: 1, inputPointer: `/evidence/${index}`,
        ...(value.kind === 'TDMS_NATIVE_RECORD' ? { nativeReadReceiptLocations: [{ evidenceRef: value.evidenceRef,
          messageIndex: 1, inputPointer: `/evidence/${index}/nativeReadReceipt` }] } : {}) } });
  }
  for (const [index, value] of view.members.entries()) {
    const expected = registry.members.get(value?.evidenceRef);
    if (!expected || delivered.members.has(value.evidenceRef) ||
        canonicalJson(memberContent(value)) !== canonicalJson(memberContent(derivedSummarySparseMemberBody(expected, registry.evidence)))) fail();
    const evidence = restoreSummaryMemberEvidence(value, restorationRegistry);
    carriers.push(...evidence);
    const { evidenceRefs, nativeReadReceipts: _receipts, documentWorkItemCarriers: _documentCarriers, ...own } = value;
    const reading = { ...own, evidence, ...(Object.hasOwn(own, 'understanding')
      ? { body: completeDerivedSummaryWorkBody(own.understanding, own.issues) } : {}) };
    validateDerivedSummaryReading(reading);
    delivered.members.set(value.evidenceRef, { value: structuredClone(value),
      location: { messageIndex: 1, inputPointer: `/members/${index}`,
        contentFields: Object.hasOwn(own, 'understanding') ? ['understanding', 'issues'] : ['body', 'issues'],
        ...(value.nativeReadReceipts ? { nativeReadReceiptLocations: value.nativeReadReceipts.map((row, receiptIndex) => ({
          evidenceRef: row.evidenceRef, messageIndex: 1,
          inputPointer: `/members/${index}/nativeReadReceipts/${receiptIndex}/receipt` })) } : {}) } });
  }
  checkSummaryNativeReceiptHistory(carriers, delivered)();
  return delivered;
}

/** Raw receipts stay complete in the original round checkpoint. Only this new
 * version strips nested sources from member tool messages after whole-receipt
 * binding validation, and never promotes Host-only data to model delivery. */
export function projectDerivedSummarySparseReadReceipt(receipt, intent, registry, delivered, { round, messageIndex }) {
  validateDerivedSummaryReadSelection(intent, registry, intent.action);
  const field = assertDerivedSummaryReadReceiptShape(receipt, intent.action);
  const values = receipt[field];
  if (!Number.isSafeInteger(round) || round < 0 || !Number.isSafeInteger(messageIndex) || messageIndex < 3 ||
      values.length !== intent.evidenceRefs.length || new Set(values.map(value => value?.evidenceRef)).size !== values.length) fail();
  const target = field === 'members' ? delivered.members : delivered.evidence;
  const allowed = field === 'members' ? registry.members : registry.evidence;
  const ownBody = value => {
    const { evidence, body, ...own } = value;
    return { ...own, ...(!Object.hasOwn(value, 'understanding') ? { body } : {}),
      evidenceRefs: summaryEvidenceRefs(evidence), ...summaryNativeReceiptFields(evidence, registry.evidence) };
  };
  // All raw contents, nested immutable roots and prior delivery must match before
  // any ledger is changed. Fresh notices are validated, then preserved in full.
  for (const value of values) {
    if (!intent.evidenceRefs.includes(value?.evidenceRef) || !allowed.has(value.evidenceRef)) fail();
    if (field === 'members') validateDerivedSummaryReading(value);
    const content = field === 'members' ? memberContent(value) : value;
    const expected = field === 'members' ? memberContent(allowed.get(value.evidenceRef)) : allowed.get(value.evidenceRef);
    if (field === 'members' ? canonicalJson(content) !== canonicalJson(expected) : !sameSummaryEvidence(content, expected)) fail();
    const projected = field === 'members' ? ownBody(value) : value;
    const previous = target.get(value.evidenceRef);
    if (previous && (field === 'members' ? canonicalJson(memberContent(previous.value)) !== canonicalJson(memberContent(projected)) : !sameSummaryEvidence(previous.value, projected))) fail();
  }
  const retainNativeReceipts = checkSummaryNativeReceiptHistory(values.flatMap(value => field === 'members' ? value.evidence : [value]), delivered);
  retainNativeReceipts();
  const items = values.map((value, index) => {
    const previous = target.get(value.evidenceRef);
    const notices = field === 'members'
      ? { current: value.current, overviewStatus: value.overviewStatus, limitations: structuredClone(value.limitations) }
      : { inheritedSourceReadIsNotFreshVerification: true };
    if (previous) return { evidenceRef: value.evidenceRef, status: 'CONFIRMED_SAME_CONTENT',
      contentLocation: structuredClone(previous.location), notices, ...nativeReceiptProjection(field === 'members' ? value.evidence : [value], messageIndex, `/items/${index}`) };
    const content = field === 'members' ? ownBody(value) : structuredClone(value);
    const location = { messageIndex, toolPointer: `/items/${index}/content`,
      ...(content.nativeReadReceipts ? { nativeReadReceiptLocations: nativeReceiptProjection(value.evidence, messageIndex,
        `/items/${index}/content`).nativeReadReceiptLocations } : {}),
      ...(content.kind === 'TDMS_NATIVE_RECORD' ? { nativeReadReceiptLocations: [{ evidenceRef: content.evidenceRef,
        messageIndex, toolPointer: `/items/${index}/content/nativeReadReceipt` }] } : {}) };
    target.set(value.evidenceRef, { value: structuredClone(content), location });
    return { evidenceRef: value.evidenceRef, status: 'DELIVERED_FULL_CONTENT', contentLocation: location, content, notices, ...nativeReceiptProjection(field === 'members' ? value.evidence : [value], messageIndex, `/items/${index}`) };
  });
  return { operation: intent.action, requestedEvidenceRefs: [...intent.evidenceRefs],
    receiptCheckpointKey: `summary-round-${round}-read`, status: 'READ_COMPLETE',
    notice: 'Host authorized and checked this exact raw read. Member content contains complete saved work and evidenceRefs only; source bodies require explicit READ_SOURCES. Same-content locators point only to prior actual bodies. Derived work and inherited source reads do not establish fresh verification, applicability or approval.', items };
}
