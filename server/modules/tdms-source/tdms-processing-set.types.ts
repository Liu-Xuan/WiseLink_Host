import type {
  TdmsProcessingRevisionSet,
  TdmsProcessingSetHead,
} from '@shared/tdms-processing-set.interface';
import type {
  TdmsReadContext,
  TdmsRecordRevision,
} from '@shared/tdms-source.interface';
import type {
  TdmsPublicActor,
  TdmsSourceScope,
  TdmsStoredAssertion,
  TdmsTransaction,
} from './tdms-source.types';
import { tdmsError } from './tdms-source.types';

/** Finite SQL projection: neither opinion content nor opaque raw/capture payloads. */
export const TDMS_PROCESSING_METADATA_FIELDS = [
  'recordRef',
  'sourceRevisionRef',
  'recordKind',
  'sourceRecordId',
  'sourceKey',
  'sourceInstanceId',
  'title',
  'fileType',
  'sourceVersion',
  'businessVersion',
  'state',
  'authors',
  'observedAt',
  'capturedAt',
  'coverage',
  'relatedDocumentVersionIds',
  'fieldSelectors',
  'sourceVerification',
  'currentness',
  'captureRef',
  'sourceModifiedAt',
  'fieldProvenance',
  'artifacts',
  'unreadAttachments',
  'selectedHead',
] as const satisfies readonly (keyof TdmsRecordRevision)[];

export interface TdmsStoredRevisionMetadata {
  scope: TdmsSourceScope;
  record: Pick<
    TdmsRecordRevision,
    (typeof TDMS_PROCESSING_METADATA_FIELDS)[number]
  > & {
    rawFields: { sourceModifiedRaw?: unknown; opinionCollection?: unknown };
  };
}

export interface TdmsProcessingSetTransaction extends TdmsTransaction {
  /** Project in storage before returning data; never fall back to the body lookup. */
  revisionMetadata(
    tenantId: string,
    ref: string,
  ): Promise<TdmsStoredRevisionMetadata | null>;
  processingSet(
    scope: TdmsSourceScope,
    ref: string,
  ): Promise<TdmsProcessingRevisionSet | null>;
  processingSetHead(
    scope: TdmsSourceScope,
    family: string,
  ): Promise<TdmsProcessingSetHead | null>;
  processingSetHistory(
    scope: TdmsSourceScope,
    family: string,
    after: string | null,
  ): Promise<TdmsProcessingRevisionSet[]>;
  processingAssertion(
    scope: TdmsSourceScope,
    ref: string,
  ): Promise<TdmsStoredAssertion | null>;
  insertProcessingSet(set: TdmsProcessingRevisionSet): Promise<void>;
  selectProcessingSet(
    head: TdmsProcessingSetHead,
    expectedGeneration: number | null,
  ): Promise<void>;
}
export interface TdmsProcessingSetRepository {
  transaction<T>(
    operation: (tx: TdmsProcessingSetTransaction) => Promise<T>,
  ): Promise<T>;
}
/** Host provider checks current application membership, source/member/relationship
 * retention or read authority AND selected-object/DM ACL. Capture actor is not an ACL.
 * These methods must verify proof refs against authority, not trust submitted strings.
 * No adapter is configured by this first slice. */
export interface TdmsProcessingSetAuthority<Actor = TdmsPublicActor> {
  readonly available: boolean;
  assertScopeAccess(input: {
    actor: Actor;
    scope: TdmsSourceScope;
    action: 'RETAIN' | 'READ';
    context: TdmsReadContext;
  }): Promise<void>;
  assertAccess(input: {
    actor: Actor;
    action: 'RETAIN' | 'READ';
    context: TdmsReadContext;
    set: TdmsProcessingRevisionSet;
    revisions: readonly TdmsStoredRevisionMetadata[];
    assertions: readonly TdmsStoredAssertion[];
  }): Promise<void>;
  compare(input: {
    actor: Actor;
    selected: TdmsProcessingRevisionSet;
    candidate: TdmsProcessingRevisionSet;
  }): Promise<{
    cohort: 'SAME' | 'SUCCESSOR' | 'PREDECESSOR' | 'UNKNOWN' | 'CONFLICT';
    roster: 'SAME' | 'SUCCESSOR' | 'PREDECESSOR' | 'UNKNOWN' | 'CONFLICT';
    evidenceRefs: string[];
    /** Source-proven observation succession, not capture timestamp order. */
    memberObservationSuccessions?: Array<{
      memberRef: string;
      olderObservationRef: string;
      newerObservationRef: string;
      evidenceRefs: string[];
    }>;
    processingObservationSuccession?: {
      olderObservationRef: string;
      newerObservationRef: string;
      evidenceRefs: string[];
    };
  }>;
}
export class UnconfiguredTdmsProcessingSetAuthority implements TdmsProcessingSetAuthority {
  readonly available = false;
  async assertScopeAccess(): Promise<void> {
    throw tdmsError('TDMS_PROCESSING_SET_AUTHORITY_UNCONFIGURED', 503);
  }
  async assertAccess(): Promise<void> {
    throw tdmsError('TDMS_PROCESSING_SET_AUTHORITY_UNCONFIGURED', 503);
  }
  async compare(): Promise<never> {
    throw tdmsError('TDMS_PROCESSING_SET_AUTHORITY_UNCONFIGURED', 503);
  }
}
