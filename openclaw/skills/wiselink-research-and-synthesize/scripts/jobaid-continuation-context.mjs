import { isDeepStrictEqual } from 'node:util';
import { sameTdmsNativeEvidenceBody } from './tdms-native-context.mjs';

function mergeExact(items, additions, key) {
  const byKey = new Map(items.map(item => [key(item), structuredClone(item)]));
  for (const item of additions) {
    const id = key(item);
    if (typeof id !== 'string' || !id ||
        (byKey.has(id) && !isDeepStrictEqual(byKey.get(id), item)))
      throw new Error('JOBAID_SOURCE_READ_FAILED:INCONSISTENT_CACHED_EVIDENCE');
    byKey.set(id, structuredClone(item));
  }
  return [...byKey.values()];
}

function appendExact(items, additions) {
  const result = structuredClone(items);
  for (const item of additions) {
    if (!result.some(prior => isDeepStrictEqual(prior, item))) result.push(structuredClone(item));
  }
  return result;
}

function mergeEvidence(items, additions) {
  const byRef = new Map(items.map(item => [item.evidenceRef, structuredClone(item)]));
  for (const item of additions) {
    const prior = byRef.get(item.evidenceRef);
    if (prior && !isDeepStrictEqual(prior, item)) {
      if (!sameTdmsNativeEvidenceBody(prior, item))
        throw new Error('JOBAID_SOURCE_READ_FAILED:INCONSISTENT_CACHED_EVIDENCE');
      const { receiptRef: _oldRef, readAt: _oldAt, ...oldBinding } = prior.nativeReadReceipt;
      const { receiptRef: _newRef, readAt: _newAt, ...newBinding } = item.nativeReadReceipt;
      if (!isDeepStrictEqual(oldBinding, newBinding))
        throw new Error('JOBAID_SOURCE_READ_FAILED:INCONSISTENT_CACHED_NATIVE_READ_BINDING');
      // Same complete native source body; each original receipt is kept separately.
      continue;
    }
    if (typeof item.evidenceRef !== 'string' || !item.evidenceRef)
      throw new Error('JOBAID_SOURCE_READ_FAILED:INCONSISTENT_CACHED_EVIDENCE');
    byRef.set(item.evidenceRef, structuredClone(item));
  }
  return [...byRef.values()];
}

/** This cache belongs to one checkpoint-bound attempt, never to a document globally. */
export function createJobAidEvidenceCache(input) {
  return {
    evidence: mergeExact([], input.deliveredEvidence, item => item.evidenceRef),
    sourceStatements: [], activityContexts: [], documents: [], nativeReadReceipts: [], reads: [],
  };
}

/** Keep the complete Host packet; only identical copies share one cache entry. */
function cacheJobAidReceipt(cache, receipt, receiptKind) {
  const { evidence, sourceStatements = [], activityContexts = [], documents = [],
    nativeReadReceipts = [], ...metadata } = receipt;
  const next = {
    evidence: mergeEvidence(cache.evidence, evidence),
    sourceStatements: mergeExact(cache.sourceStatements, sourceStatements, item => item.ref),
    activityContexts: mergeExact(cache.activityContexts, activityContexts,
      item => JSON.stringify([item.runRef, item.candidateRevision])),
    documents: appendExact(cache.documents, documents),
    nativeReadReceipts: mergeExact(cache.nativeReadReceipts, nativeReadReceipts, item => item.receiptRef),
    reads: structuredClone(cache.reads),
  };
  const read = {
    ...metadata,
    receiptKind,
    evidenceRefs: evidence.map(item => item.evidenceRef),
    ...(sourceStatements.length ? { sourceStatementRefs: sourceStatements.map(item => item.ref) } : {}),
    ...(activityContexts.length ? { activityContextKeys: activityContexts.map(
      item => [item.runRef, item.candidateRevision]) } : {}),
    ...(documents.length ? { documentIndices: documents.map(
      item => next.documents.findIndex(prior => isDeepStrictEqual(prior, item))) } : {}),
    ...(nativeReadReceipts.length ? { nativeReadReceiptIndices: nativeReadReceipts.map(
      item => next.nativeReadReceipts.findIndex(prior => isDeepStrictEqual(prior, item))) } : {}),
    ...(evidence.some(item => item.kind === 'TDMS_NATIVE_RECORD') ? {
      nativeEvidenceReceipts: evidence.filter(item => item.kind === 'TDMS_NATIVE_RECORD').map(item => ({
        evidenceRef: item.evidenceRef,
        receiptIndex: next.nativeReadReceipts.findIndex(prior => isDeepStrictEqual(prior, item.nativeReadReceipt)),
      })),
    } : {}),
  };
  if (read.nativeEvidenceReceipts?.some(item => item.receiptIndex < 0))
    throw new Error('JOBAID_SOURCE_READ_FAILED:INCONSISTENT_CACHED_NATIVE_READ_BINDING');
  let index = next.reads.findIndex(prior => isDeepStrictEqual(prior, read));
  if (index < 0) { index = next.reads.length; next.reads.push(read); }
  return { cache: next, index };
}

export function cacheJobAidSourceRead(cache, receipt) {
  const { cache: next, index } = cacheJobAidReceipt(cache, receipt, 'SOURCE_READ');
  return { cache: next, receipt: { status: receipt.status, cachedReadIndex: index,
    instruction: 'The full Host read is in deliveredEvidence and deliveredSourceReads at this index; references are not a substitute for those delivered bodies.' } };
}

/** Cache a real final query receipt without promoting its state or source authority. */
export function cacheJobAidKnowledgeReceipt(cache, receipt) {
  return cacheJobAidReceipt(cache, receipt, 'KNOWLEDGE_QUERY').cache;
}

export function projectJobAidContinuationContext(input, cache, targetWork) {
  return {
    ...input,
    deliveredEvidence: structuredClone(cache.evidence),
    ...(cache.reads.length ? { deliveredSourceReads: {
      reads: structuredClone(cache.reads),
      ...Object.fromEntries(['sourceStatements', 'activityContexts', 'documents', 'nativeReadReceipts']
        .filter(key => cache[key].length).map(key => [key, structuredClone(cache[key])])),
    } } : {}),
    ...(targetWork ? { targetWork: structuredClone(targetWork) } : {}),
  };
}

/** Full saved targets are comparison data, not guessed replacements or fresh source reads. */
export function projectJobAidTargetWork(revision, issueKeys, includeOverview) {
  const byKey = new Map(revision.content.issues.map(issue => [issue.issueKey, issue]));
  if (!Array.isArray(issueKeys) || new Set(issueKeys).size !== issueKeys.length ||
      issueKeys.some(key => typeof key !== 'string' || !byKey.has(key)) ||
      typeof includeOverview !== 'boolean' || (!issueKeys.length && !includeOverview))
    throw new Error('JOBAID_WORK_TARGET_INVALID');
  return {
    schemaVersion: 'wiselink.jobaid-target-work-read.v1', status: 'AVAILABLE',
    workRevisionRef: revision.workRevisionRef, workRevision: revision.workRevision,
    overviewStatus: revision.content.overviewStatus ?? null,
    issues: issueKeys.map(key => structuredClone(byKey.get(key))),
    ...(includeOverview ? { overview: revision.content.understanding ?? revision.content.overview ?? null } : {}),
    instruction: 'These are complete issues from this exact Host revision. Preserve every unchanged condition and professional record when replacing an issue. Host identities and calculated scores are comparison-only, not workJson fields. This read is not a new source verification.',
  };
}

export function mergeJobAidTargetWork(prior, next) {
  if (!prior || prior.workRevisionRef !== next.workRevisionRef) return structuredClone(next);
  return { ...prior, ...next,
    issues: mergeExact(prior.issues, next.issues, item => item.issueKey),
    ...(Object.hasOwn(prior, 'overview') && !Object.hasOwn(next, 'overview')
      ? { overview: prior.overview } : {}),
  };
}
