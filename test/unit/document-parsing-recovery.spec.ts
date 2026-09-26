import { canAutomaticallyRecoverDocumentParse, documentParseRecoveryPredecessor,
  documentParseRecoveryRequestId } from '../../shared/document-parsing-recovery';

const id = 'PRUN-00000000-0000-0000-0000-000000000001';
const now = Date.parse('2026-09-26T12:00:00Z');
const deadlineAt = '2026-09-26T11:00:00Z';

it('uses a strict immutable predecessor identity and leaves ordinary requests alone', () => {
  expect(documentParseRecoveryPredecessor(documentParseRecoveryRequestId(id))).toBe(id);
  expect(documentParseRecoveryPredecessor('parse-original')).toBeNull();
  for (const invalid of ['parse-resume-', 'parse-resume-PRUN-x', `parse-resume-${id}-extra`])
    expect(() => documentParseRecoveryPredecessor(invalid)).toThrow('DOCUMENT_PARSE_RECOVERY_REQUEST_INVALID');
  expect(() => documentParseRecoveryRequestId('unknown')).toThrow('DOCUMENT_PARSE_RECOVERY_REQUEST_INVALID');
});

it('only automatically recovers expiry with no failure or a recorded interruption', () => {
  expect(canAutomaticallyRecoverDocumentParse({ status: 'STAGING', errorCode: null, deadlineAt }, now)).toBe(true);
  expect(canAutomaticallyRecoverDocumentParse({ status: 'FAILED', errorCode: 'DOCUMENT_PARSE_INTERRUPTED', deadlineAt }, now)).toBe(true);
  for (const errorCode of ['HOSTED_MODEL_QUOTA_EXHAUSTED', 'RATE_LIMIT_EXCEEDED', 'DOCUMENT_PARSE_FAILED',
    'DOCUMENT_PARSE_SOURCE_CHANGED', 'DOCUMENT_ORIGINAL_READBACK_DIGEST_MISMATCH', null]) {
    expect(canAutomaticallyRecoverDocumentParse({ status: 'FAILED', errorCode, deadlineAt }, now)).toBe(false);
  }
  for (const deadline of ['invalid', '2026-09-26T13:00:00Z'])
    expect(canAutomaticallyRecoverDocumentParse({ status: 'STAGING', errorCode: null, deadlineAt: deadline }, now)).toBe(false);
  expect(canAutomaticallyRecoverDocumentParse({ status: 'PUBLISHED', errorCode: 'DOCUMENT_PARSE_INTERRUPTED', deadlineAt }, now)).toBe(false);
});
