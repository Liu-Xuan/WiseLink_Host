import type { JobAidActivityRead, JobAidKnowledgeObservationStatus } from '@shared/jobaid-activity.interface';
import { isJobAidConsumerStoppedReport } from '@shared/jobaid-activity.interface';
import { parseAilyStageOverall } from './program-controlled-assessment';

export const JOBAID_ACTIVITY_WINDOW = 50;
export interface JobAidExecutionObservation {
  attemptId: string;
  attemptRef: string | null;
  status: string;
  activityJson: string | null;
}
export interface JobAidSavedActivityObservation {
  workRevisionRef: string;
  workRevision: number;
  createdAt: Date;
}

/** Read and save lists have distinct source order; no invented common event sequence. */
export function projectJobAidActivity(
  attempt: JobAidExecutionObservation,
  saves: JobAidSavedActivityObservation[],
): JobAidActivityRead {
  const result: JobAidActivityRead = {
    attemptRef: attempt.attemptRef,
    candidateOnly: true,
    sourceReads: [],
    knowledgeObservations: [],
    savedRevisions: saves
      .slice(0, JOBAID_ACTIVITY_WINDOW)
      .reverse()
      .map((row) => ({
        workRevisionRef: row.workRevisionRef,
        workRevision: row.workRevision,
        savedAt: row.createdAt.toISOString(),
      })),
    omittedEarlierRecordCount: 0,
    unknownRecordCount: 0,
    malformedRecordCount: 0,
    hasEarlierSavedRevisions: saves.length > JOBAID_ACTIVITY_WINDOW,
    error: null,
  };
  let records: unknown;
  try {
    records = JSON.parse(attempt.activityJson ?? '[]');
  } catch {
    result.error = 'ACTIVITY_RECORDS_INVALID';
    return result;
  }
  if (!Array.isArray(records)) {
    result.error = 'ACTIVITY_RECORDS_INVALID';
    return result;
  }
  const offset = Math.max(0, records.length - JOBAID_ACTIVITY_WINDOW);
  result.omittedEarlierRecordCount = offset;
  for (let index = offset; index < records.length; index++) {
    const record: unknown = records[index];
    if (
      !record ||
      typeof record !== 'object' ||
      Array.isArray(record) ||
      !('kind' in record)
    ) {
      result.malformedRecordCount++;
      continue;
    }
    if (record.kind === 'ASSESSMENT_CONSUMER_STOPPED') {
      const observedAt = 'observedAt' in record ? record.observedAt : null;
      if (!isJobAidConsumerStoppedReport(record) || typeof observedAt !== 'string' ||
          !Number.isFinite(Date.parse(observedAt))) {
        result.malformedRecordCount++;
        continue;
      }
      result.consumerStopped = { sequence: index + 1, observedAt,
        modelRound: record.modelRound, errorCode: record.errorCode, upstreamOutcome: 'UNKNOWN' };
      continue;
    }
    if (record.kind === 'AILY_STAGE_OVERALL') {
      try {
        if (!('receipt' in record)) throw new Error();
        const stage = parseAilyStageOverall(record.receipt);
        if (stage.sourceAssessment.actionAttemptId !== attempt.attemptId || !('observedAt' in record) || record.observedAt !== stage.observedAt)
          throw new Error();
      } catch { result.malformedRecordCount++; }
      continue;
    }
    if (record.kind === 'ASSESSMENT_KNOWLEDGE_OBSERVED') {
      const status = 'status' in record ? record.status : null;
      const observedAt = 'observedAt' in record ? record.observedAt : null;
      if (typeof status !== 'string' ||
        !['REQUESTED', 'STARTING', 'RUNNING', 'COMPLETED', 'FAILED', 'UNKNOWN', 'UNAVAILABLE'].includes(status) ||
        (observedAt !== null && (typeof observedAt !== 'string' || !Number.isFinite(Date.parse(observedAt))))) {
        result.malformedRecordCount++;
        continue;
      }
      result.knowledgeObservations!.push({ sequence: index + 1,
        observedAt: typeof observedAt === 'string' ? observedAt : null,
        status: status as JobAidKnowledgeObservationStatus });
      continue;
    }
    if (record.kind === 'ASSESSMENT_PROGRAM_PROGRESS' || record.kind === 'ASSESSMENT_WORK_READ') {
      const value = record as Record<string, unknown>;
      const valid = typeof value.observedAt === 'string' && Number.isFinite(Date.parse(value.observedAt)) &&
        (record.kind === 'ASSESSMENT_PROGRAM_PROGRESS'
          ? ['MATERIALS_READY', 'MODEL_RESPONSE_SAVED'].includes(String(value.phase)) &&
            typeof value.checkpointRef === 'string' && /^[A-Za-z0-9:._-]{1,512}$/u.test(value.checkpointRef)
          : typeof value.workRevisionRef === 'string' && /^JAWR-[A-Za-z0-9-]{1,91}$/u.test(value.workRevisionRef) &&
            Number.isSafeInteger(value.workRevision) && Number(value.workRevision) > 0 &&
            typeof value.saveRequestId === 'string' && /^[A-Za-z0-9:_-]{1,96}$/u.test(value.saveRequestId));
      if (!valid) result.malformedRecordCount++;
      // Execution exposes only the safe latest phase; saved-work proof remains
      // server-owned and is never expanded into restricted source metadata here.
      continue;
    }
    if (record.kind !== 'ASSESSMENT_SOURCES_READ') {
      result.unknownRecordCount++;
      continue;
    }
    if (
      !('sourceRefs' in record) ||
      !Array.isArray(record.sourceRefs) ||
      !record.sourceRefs.every(
        (ref: unknown) => typeof ref === 'string' && ref.length > 0,
      )
    ) {
      result.malformedRecordCount++;
      continue;
    }
    const observedAt = 'observedAt' in record ? record.observedAt : null;
    if (
      observedAt !== null &&
      (typeof observedAt !== 'string' ||
        !Number.isFinite(Date.parse(observedAt)))
    ) {
      result.malformedRecordCount++;
      continue;
    }
    // Source identifiers and purpose may reveal restricted supplemental input.
    // Only the actual delivered-reference count leaves this metadata projection.
    result.sourceReads.push({
      sequence: index + 1,
      sourceCount: record.sourceRefs.length,
      observedAt: typeof observedAt === 'string' ? observedAt : null,
    });
  }
  return result;
}
