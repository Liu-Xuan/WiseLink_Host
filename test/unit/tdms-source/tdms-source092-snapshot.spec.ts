import vectors from '../../fixtures/tdms-source/source092-snapshot-vectors.json';
import { adaptTdmsDailySource } from '@server/modules/tdms-source/tdms-daily-source-adapter';
import { completeContentIdentityProjection } from '@server/modules/tdms-source/tdms-complete-owned-source.validation';
import { hash } from '@server/modules/tdms-source/tdms-source.validation';
import { current092Envelope, current092Original, type Source092Scope } from './tdms-source092-dto.fixture';
import { current092AdEnvelope } from './tdms-source092-ad-native.fixture';

function inputFor(key: string) {
  const [scope, stage] = key.split(':') as [Source092Scope, string];
  if (stage === 'ORIGINAL') return current092Original(scope).env;
  if (scope === 'AD' && stage === 'FULL_VALUE') return current092AdEnvelope('SYNTHETIC-V2');
  if (scope === 'AD' && stage === 'FULL') return current092AdEnvelope();
  return current092Envelope(scope, stage as 'OWNER_PRIMARY' | 'FULL');
}

describe('Source0.2.92 independent pure snapshot projection vectors', () => {
  it('identifies the exact Source declarations and the limited mathematical oracle', () => {
    expect(vectors.qualification).toBe('SOURCE_PURE_PROJECTION_ONLY_WITH_FIXED_SYNTHETIC_INPUT_GUARD');
    expect(vectors.sourceVersion).toBe('0.2.92');
    expect(vectors.declarations.map(item => item.name)).toEqual([
      'stable', 'sha256', 'withoutTimes', 'normalizeCompleteCaptureLocators',
      'completeTimelineIdentityRecord', 'completeSbColumnIdentityRecord',
      'completeContentIdentityProjection', 'snapshotIdentity', 'completeOwnedStableProjection',
    ]);
    expect(vectors.guardCalls).toBeGreaterThan(0);
    // Frozen Source functions did not call Host projection/hash code. Their validation call used a fixed-input digest guard.
    // These vectors do not assert Source factual validation, upstream freshness, authorization or collection admission.
    expect(vectors.modules.every(module => /^[a-f0-9]{64}$/u.test(module.sourceSha256))).toBe(true);
  });
  it.each(vectors.cases)('$key keeps the independent Source identity through the production DTO consumer', vector => {
    const input = inputFor(vector.key);
    const record = input.package.records[0];
    expect(hash(record)).toBe(vector.inputSha256);
    expect('TDMSSNAP-' + hash(completeContentIdentityProjection(record))).toBe(vector.snapshotId);
    expect(hash(completeContentIdentityProjection(record))).toBe(vector.sourceProjectionSha256);
    expect(record.snapshotId).toBe(vector.snapshotId);
    const prepared = adaptTdmsDailySource(input);
    expect(prepared.envelope.package.records[0].snapshotId).toBe(vector.snapshotId);
  });
});
