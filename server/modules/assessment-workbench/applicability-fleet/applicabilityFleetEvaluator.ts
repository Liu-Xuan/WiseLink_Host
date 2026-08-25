/**
 * WiseLink 3.1 applicability-fleet: evaluation facade (applicability gate).
 *
 * Single source-level entry point for the applicability/fleet lane. Combines:
 * - FleetMasterData resolution (Host DV / professional-package records +
 *   aircraftNumber + asOf + fleet facts) — missing necessary fleet facts
 *   resolve to an observable WAITING_INPUT outcome, never a silent guess;
 * - the migrated Kleene evaluator — applicability false stays NOT_APPLICABLE
 *   and is never promoted to PASS, unknown stays needs_review;
 * - source & currentness preservation — every candidate result carries
 *   SourceRef, assetVersionId, recordHash and the fleet source snapshot /
 *   revision / authority currentness, with assessmentAsOf never masquerading
 *   as fleet currentness.
 *
 * All outputs are CANDIDATE_ONLY. This module creates no EvidenceRef,
 * ClosureDecision, ActionReadiness or any approval/signoff object.
 */

import {
  UNKNOWN,
  evaluateWithTrace,
  kleeneToAssessmentDecision,
  type ApplicabilityAstNode,
  type ApplicabilityFleetSnapshot,
  type BlockingUnknown,
  type KleeneTrace,
} from './applicabilityKleeneEngine';
import {
  resolveFleetSnapshot,
  type FleetMasterDataSource,
  type FleetSourceCurrentness,
  type FleetSourceRef,
} from './fleetMasterData';

export const APPLICABILITY_FLEET_EVALUATION_SCHEMA_VERSION =
  'wiselink.v3_1.applicability_fleet.evaluation.v1' as const;

export type ApplicabilityFleetGateStatus =
  | 'EVALUATED'
  | 'WAITING_INPUT'
  | 'NOT_EVALUABLE';

export interface ApplicabilityFleetEvaluationInput {
  dataSource: FleetMasterDataSource;
  aircraftNumber: string;
  asOf: string;
  /** Kleene assert AST from the document applicability extraction. */
  applicabilityAst: ApplicabilityAstNode | null;
}

export interface ApplicabilityFleetBlockingUnknown extends BlockingUnknown {
  [key: string]: unknown;
}

export interface ApplicabilityFleetEvaluationResult {
  schemaVersion: typeof APPLICABILITY_FLEET_EVALUATION_SCHEMA_VERSION;
  status: ApplicabilityFleetGateStatus;
  /** Kleene decision: applicable | not_applicable | needs_review. */
  decision: string;
  /** Kleene result value preserved verbatim (true / false / 'unknown'). */
  kleeneResult: boolean | typeof UNKNOWN | null;
  /** true only when decision === 'applicable' AND gate status is EVALUATED. */
  pass: boolean;
  blockingUnknowns: ApplicabilityFleetBlockingUnknown[];
  sourceProvenance: {
    assetId: string | null;
    assetVersionId: string | null;
    recordHash: string | null;
    sourceRefs: FleetSourceRef[];
    sourceCurrentness: FleetSourceCurrentness;
    /** assessmentAsOf is the request asOf, distinct from source currentness. */
    assessmentAsOf: string;
  };
  authorityBoundary: {
    outputAuthorityLevel: 'candidate_only';
    createsEvidenceRef: false;
    createsClosureDecision: false;
    createsActionReadiness: false;
  };
}

function notEvaluableResult(
  input: ApplicabilityFleetEvaluationInput,
  blockingUnknowns: ApplicabilityFleetBlockingUnknown[],
): ApplicabilityFleetEvaluationResult {
  return {
    schemaVersion: APPLICABILITY_FLEET_EVALUATION_SCHEMA_VERSION,
    status: 'NOT_EVALUABLE',
    decision: 'needs_review',
    kleeneResult: null,
    pass: false,
    blockingUnknowns,
    sourceProvenance: {
      assetId: null,
      assetVersionId: null,
      recordHash: null,
      sourceRefs: [],
      sourceCurrentness: {
        sourceSnapshotId: input.dataSource.sourceSnapshotId ?? null,
        sourceRevisionKey: input.dataSource.sourceRevisionKey ?? null,
        authorityRevision: input.dataSource.authorityRevision ?? null,
        status: 'UNVERIFIED',
        sourceAsOf: input.dataSource.sourceAsOf ?? null,
        reason: 'FLEET_MASTER_DATA_NOT_RESOLVED',
      },
      assessmentAsOf: input.asOf,
    },
    authorityBoundary: {
      outputAuthorityLevel: 'candidate_only',
      createsEvidenceRef: false,
      createsClosureDecision: false,
      createsActionReadiness: false,
    },
  };
}

function toBlockingUnknowns(trace: KleeneTrace): ApplicabilityFleetBlockingUnknown[] {
  return Array.isArray(trace.blockingUnknowns) ? trace.blockingUnknowns : [];
}

export function evaluateApplicabilityForAircraft(
  input: ApplicabilityFleetEvaluationInput,
): ApplicabilityFleetEvaluationResult {
  const resolution = resolveFleetSnapshot({
    dataSource: input.dataSource,
    aircraftNumber: input.aircraftNumber,
    asOf: input.asOf,
  });

  if (resolution.status === 'WAITING_INPUT' || !resolution.snapshot) {
    return {
      ...notEvaluableResult(input, resolution.missingFacts as ApplicabilityFleetBlockingUnknown[]),
      status: 'WAITING_INPUT',
      blockingUnknowns: [
        ...(resolution.missingFacts as ApplicabilityFleetBlockingUnknown[]),
        ...(resolution.conflictingFacts as unknown as ApplicabilityFleetBlockingUnknown[]),
          ...((resolution.sourceCurrentness.status !== 'CURRENT'
              ? [{
              kind: 'interpretation_unknown' as const,
              reason: `FLEET_SOURCE_CURRENTNESS_${resolution.sourceCurrentness.status}`,
            strategy: 'direct_fact',
          }]
      : []) as ApplicabilityFleetBlockingUnknown[]),
      ],
        sourceProvenance: {
        ...notEvaluableResult(input, []).sourceProvenance,
      assetId: resolution.provenance?.assetId ?? null,
    assetVersionId: resolution.provenance?.assetVersionId ?? null,
  recordHash: resolution.provenance?.recordHash ?? null,
        sourceRefs: resolution.provenance?.sourceRefs ?? [],
        sourceCurrentness: resolution.sourceCurrentness,
      },
    };
  }

  const snapshot: ApplicabilityFleetSnapshot = resolution.snapshot;
  const trace = evaluateWithTrace(input.applicabilityAst, snapshot, null);
  const decision = kleeneToAssessmentDecision(trace.result);
  const blockingUnknowns = toBlockingUnknowns(trace);
  const evaluated =
    resolution.sourceCurrentness.status === 'CURRENT' ? 'EVALUATED' : 'NOT_EVALUABLE';
  const status: ApplicabilityFleetGateStatus =
    decision === 'needs_review' && blockingUnknowns.length > 0
      ? 'WAITING_INPUT'
      : (evaluated as ApplicabilityFleetGateStatus);

  return {
    schemaVersion: APPLICABILITY_FLEET_EVALUATION_SCHEMA_VERSION,
    status,
    decision,
    kleeneResult: trace.result,
    // false is never promoted to PASS; only an EVALUATED applicable passes.
    pass: status === 'EVALUATED' && decision === 'applicable',
    blockingUnknowns,
    sourceProvenance: {
      assetId: resolution.provenance?.assetId ?? null,
      assetVersionId: resolution.provenance?.assetVersionId ?? null,
      recordHash: resolution.provenance?.recordHash ?? null,
      sourceRefs: resolution.provenance?.sourceRefs ?? [],
      sourceCurrentness: resolution.sourceCurrentness,
      assessmentAsOf: input.asOf,
    },
    authorityBoundary: {
      outputAuthorityLevel: 'candidate_only',
      createsEvidenceRef: false,
      createsClosureDecision: false,
      createsActionReadiness: false,
    },
  };
}
