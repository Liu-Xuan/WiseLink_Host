import { validateCompleteOwnedObservation } from '@server/modules/tdms-source/tdms-complete-owned-source.validation';
import { adaptTdmsDailySource } from '@server/modules/tdms-source/tdms-daily-source-adapter';
import { current092AdEnvelope, current092AdObservation, type Source092AdRead } from './tdms-source092-ad-native.fixture';
import { source092RecordProof } from './tdms-source092-dto.fixture';

describe('current Source0.2.92 AD same native row version', () => {
  it.each(['\u00a0', 'SYNTHETIC-V2'])('keeps exact native same-row value %j and unreviewed enumeration distinct', value => {
    const observation = current092AdObservation(value);
    const read = validateCompleteOwnedObservation(observation, observation.requestedCriteria).reads[1];
    expect(read.owner.businessVersionEvidence.rawValue).toBe(value.trim() ? value : '');
    expect(read.relationTables[0].relatedSurfaceEvidence.before.rows[0].businessVersion.rawValue).toBe(value);
    expect(read.relationTables[0].enumerationState).toBe('NOT_READ');
    expect(read.relationTables[0].terminal.nativeTerminal).toBe(false);
  });
  it.each(['\u00a0', 'SYNTHETIC-V2'])('retains the current full AD native DTO for %j through the production prepare consumer', value => {
    const envelope = current092AdEnvelope(value);
    const before = JSON.stringify(envelope);
    const prepared = adaptTdmsDailySource(envelope);
    const record = prepared.envelope.package.records[0];
    const proof = source092RecordProof<Source092AdRead>(record);
    expect(record.businessVersion).toEqual(value.trim() ? {
      rawRevision: value, rawIteration: null, confirmation: 'SOURCE_DECLARED',
    } : null);
    expect(proof.requestedCriteria.collectionStage).toBeUndefined();
    expect(proof.reads[1].relationTables[0].relatedSurfaceEvidence.after.rows[0].businessVersion.rawValue).toBe(value);
    expect(record.coverage.status).toBe('PARTIAL');
    expect(proof.reads[1].relationTables[0].terminal.nativeTerminal).toBe(false);
    expect(JSON.stringify(envelope)).toBe(before);
  });
  it('cannot borrow a child row business version for its parent', () => {
    const observation = current092AdObservation('SYNTHETIC-V2', false);
    expect(() => validateCompleteOwnedObservation(observation, observation.requestedCriteria)).toThrow();
  });
  it('requires the same source technical version and source modified mirrors', () => {
    const observation = current092AdObservation('SYNTHETIC-V2');
    observation.reads[1].relationTables[0].relatedSurfaceEvidence.ownerSourceVersion.rawIteration = 'FOREIGN';
    expect(() => validateCompleteOwnedObservation(observation, observation.requestedCriteria)).toThrow();
  });
  it('does not admit a late changed row or a stale own modified mirror', () => {
    const changed = current092AdObservation('SYNTHETIC-V2');
    changed.reads[1].relationTables[0].relatedSurfaceEvidence.after.rows[0].businessVersion.rawValue = 'SYNTHETIC-V3';
    expect(() => validateCompleteOwnedObservation(changed, changed.requestedCriteria)).toThrow();
    const stale = current092AdObservation('SYNTHETIC-V2');
    for (const read of stale.reads) {
      const mirror = read.fields.find(field => field.value.actualLabel === 'Last Modified:');
      mirror.value.rawValue = 'SYNTHETIC STALE MODIFIED';
      mirror.value.observedTotalCodepoints = [...mirror.value.rawValue].length;
    }
    expect(() => validateCompleteOwnedObservation(stale, stale.requestedCriteria)).toThrow();
  });
});
