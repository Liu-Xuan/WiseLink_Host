import {
  hasCorrectionUnchangedReceipt,
  savedCorrectionWorkRef,
} from '../../server/modules/canonical-host/engineering-matter-working.repository';

const save = (workRef: string, workingRevision: number, requestId: string, attemptId = 'ATT-1') => ({
  attemptId, workRef, workingRevision, requestId,
});

const receipt = (workRevisionRef: string, expectedWorkRevision: number, requestId: string) => ({
  kind: 'MATTER_JOBAID_WORK_SAVED', workRevisionRef, expectedWorkRevision, requestId,
});

describe('saved correction work projection', () => {
  it('selects the newest work from the same attempt only when its exact save receipt exists', () => {
    const saves = [save('MWR-2', 2, 'REQ-2'), save('MWR-4', 4, 'REQ-4'), save('OTHER', 9, 'REQ-X', 'ATT-X')];
    const events = JSON.stringify([receipt('MWR-4', 3, 'REQ-4'), receipt('MWR-2', 1, 'REQ-2')]);
    expect(savedCorrectionWorkRef('ATT-1', events, saves)).toBe('MWR-4');
  });

  it('does not accept a row with a mismatched request, expected revision or work ref', () => {
    const saves = [save('MWR-4', 4, 'REQ-4')];
    for (const event of [
      receipt('MWR-4', 3, 'OTHER'),
      receipt('MWR-4', 2, 'REQ-4'),
      receipt('MWR-FAKE', 3, 'REQ-4'),
    ]) expect(savedCorrectionWorkRef('ATT-1', JSON.stringify([event]), saves)).toBeNull();
  });

  it('does not fabricate a saved work from an absent receipt or another attempt', () => {
    expect(savedCorrectionWorkRef('ATT-1', '[]', [save('MWR-4', 4, 'REQ-4')])).toBeNull();
    expect(savedCorrectionWorkRef('ATT-1', JSON.stringify([receipt('MWR-4', 3, 'REQ-4')]),
      [save('MWR-4', 4, 'REQ-4', 'ATT-X')])).toBeNull();
  });

  it('rejects malformed persisted activity instead of silently trusting it', () => {
    expect(() => savedCorrectionWorkRef('ATT-1', '{', [])).toThrow('ENGINEERING_MATTER_WORKING_PERSISTENCE_INVALID');
    expect(() => savedCorrectionWorkRef('ATT-1', '{}', [])).toThrow('ENGINEERING_MATTER_WORKING_PERSISTENCE_INVALID');
  });

  it('recognizes unchanged only from the exact retained-work receipt', () => {
    const exact = { kind: 'MATTER_CORRECTION_UNCHANGED', requestId: 'REQ-U',
      workRevisionRef: 'MWR-4', workRevision: 4 };
    expect(hasCorrectionUnchangedReceipt(JSON.stringify([exact]), 'MWR-4', 4)).toBe(true);
    expect(hasCorrectionUnchangedReceipt(JSON.stringify([{ ...exact, workRevisionRef: 'OTHER' }]), 'MWR-4', 4)).toBe(false);
    expect(hasCorrectionUnchangedReceipt(JSON.stringify([{ ...exact, workRevision: 3 }]), 'MWR-4', 4)).toBe(false);
    expect(hasCorrectionUnchangedReceipt(JSON.stringify([{ kind: 'MODEL_OUTPUT', unchanged: true }]), 'MWR-4', 4)).toBe(false);
  });
});
