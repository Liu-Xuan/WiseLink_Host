import type { JobAidActivityRead } from '@shared/jobaid-activity.interface';

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
