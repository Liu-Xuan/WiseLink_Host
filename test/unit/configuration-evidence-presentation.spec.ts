import type { CanonicalConfigurationEvidenceStatusReadModel } from '../../shared/api.interface';
import { presentConfigurationEvidence } from '../../client/src/pages/DocumentParsingPage/configuration-evidence-presentation';

describe('configuration evidence presentation', () => {
  it('keeps a disconnected event ledger distinct from no record', () => {
    const view = presentConfigurationEvidence(status('NOT_CONNECTED', 0));

    expect(view.state).toBe('NOT_CONNECTED');
    expect(view.queryLabel).toBe('受控事件账本未接通');
    expect(view.guidance).toContain('不能据此推断无记录');
  });

  it('keeps partial or failed validation distinct from COMPLETE', () => {
    const value = status('FAILED_VALIDATION', 2);
    value.current = current('PARTIAL');

    const view = presentConfigurationEvidence(value);

    expect(view.state).toBe('PARTIAL_OR_FAILED_VALIDATION');
    expect(view.queryLabel).toContain('校验未通过');
    expect(view.currentCoverageLabel).toBe('当前覆盖：不完整');
  });

  it('shows COMPLETE with evidence only after Host current adoption', () => {
    const value = status('SUCCEEDED_EVIDENCE', 3);
    markLatestAdopted(value);
    value.current = current('COMPLETE');

    expect(presentConfigurationEvidence(value)).toMatchObject({
      state: 'COMPLETE_WITH_EVIDENCE',
      queryLabel: '完整覆盖，已有受控证据',
      currentCoverageLabel: '当前覆盖：完整',
    });
  });

  it('shows trusted no record only after Host proves COMPLETE current', () => {
    const value = status('SUCCEEDED_NO_RECORD', 0);
    markLatestAdopted(value);
    value.current = current('COMPLETE');

    const view = presentConfigurationEvidence(value);

    expect(view.state).toBe('COMPLETE_TRUSTED_NO_RECORD');
    expect(view.queryLabel).toBe('完整覆盖，可信无记录');
    expect(view.guidance).toContain('无记录不等于事实为 FALSE');
  });

  it('does not promote a zero-record candidate without coverage proof', () => {
    const value = status('SUCCEEDED_NO_RECORD', 0);
    value.current = current('PARTIAL');

    const view = presentConfigurationEvidence(value);

    expect(view.state).toBe('NO_RECORD_COVERAGE_UNPROVEN');
    expect(view.queryLabel).toBe('零记录候选，覆盖未证明');
    expect(view.guidance).toContain('跨层复合覆盖 COMPLETE');
    expect(view.queryLabel).not.toContain('可信无记录');
  });

  it('fails closed when the terminal status contradicts the record count', () => {
    const view = presentConfigurationEvidence(status('SUCCEEDED_NO_RECORD', 1));

    expect(view.state).toBe('INCONSISTENT_READ_MODEL');
    expect(view.guidance).toContain('前端拒绝推断');
  });
});

function status(
  terminalStatus: NonNullable<
    CanonicalConfigurationEvidenceStatusReadModel['latestQuery']
  >['terminalStatus'],
  sourceRecordCount: number,
): CanonicalConfigurationEvidenceStatusReadModel {
  return {
    schemaVersion: 'wiselink.3_1.configuration_evidence_status.v1',
    workItemId: 'WI-CONFIGURATION',
    workItemRevision: 8,
    source: { configured: terminalStatus !== 'NOT_CONNECTED' },
    latestQuery: {
      queryAttemptRef: 'EQ-1',
      candidateEvidenceRef: 'CE-1',
      inputRevision: 8,
      terminalStatus,
      sourceRecordCount,
      completedAt: '2026-09-05T08:00:00.000Z',
      adoptionStatus: 'CANDIDATE_UNADOPTED',
      adoptionEligible:
        terminalStatus === 'SUCCEEDED_EVIDENCE' ||
        terminalStatus === 'SUCCEEDED_NO_RECORD',
      adoptionBlockReason:
        terminalStatus === 'SUCCEEDED_EVIDENCE' ||
        terminalStatus === 'SUCCEEDED_NO_RECORD'
          ? null
          : 'QUERY_NOT_ADOPTABLE',
    },
    current: null,
    reevaluation: null,
    authority: {
      owner: 'CANONICAL_HOST',
      candidateOnly: true,
      noRecordMeansFalse: false,
      notConnectedMeansFalse: false,
    },
  };
}

function markLatestAdopted(
  value: CanonicalConfigurationEvidenceStatusReadModel,
): void {
  if (!value.latestQuery) throw new Error('LATEST_QUERY_REQUIRED');
  value.latestQuery.adoptionStatus = 'ADOPTED';
  value.latestQuery.adoptionEligible = false;
  value.latestQuery.adoptionBlockReason = 'ALREADY_ADOPTED';
}

function current(
  sourceCompleteness: NonNullable<
    CanonicalConfigurationEvidenceStatusReadModel['current']
  >['sourceCompleteness'],
): NonNullable<CanonicalConfigurationEvidenceStatusReadModel['current']> {
  return {
    snapshotId: 'CS-1',
    configurationRevision: 3,
    aircraftAssetId: 'AIRCRAFT-1',
    assessmentAsOf: '2026-09-05T07:00:00.000Z',
    sourceCompleteness,
    truthSummary: {
      trueCount: 1,
      falseCount: 0,
      unknownCount: 0,
      conflictCount: 0,
    },
    recordedAt: '2026-09-05T08:00:00.000Z',
  };
}
