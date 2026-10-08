import {
  sourcePackage,
  packageGaps,
} from '../../../server/modules/tdms-source/tdms-source.validation';
import { fixture } from './tdms-fixtures';
describe('multi-domain semantic non-inference and bounded contract', () => {
  it.each(['AEO', 'CEO-S', 'MT', 'EB', 'MON', 'MRO', 'future unknown'])(
    'preserves %s without inventing mandatory/execution semantics',
    (type) => {
      const p = fixture();
      p.records[0]!.fileType = { rawCode: type, rawName: type };
      const r = sourcePackage(p).records[0]!;
      expect(r.fileType!.rawCode).toBe(type);
      expect(r.rawFields).toEqual({ mandatory: false, checkbox: false });
      expect(r).not.toHaveProperty('executionVerified');
    },
  );
  it('keeps execution target, frequency, business revision and completion credit separate', () => {
    const p = fixture();
    p.records[0]!.businessVersion = {
      rawRevision: 'business 3',
      rawIteration: null,
      confirmation: 'SOURCE_DECLARED',
    };
    p.records[0]!.content.executionDeclaration = {
      target: { rawCode: 'aircraft', rawName: 'one', scope: { serial: 'N1' } },
      frequency: { rawCode: 'ONCE', rawName: 'one-time' },
      completionRecognition: {
        rawCode: 'CREDIT',
        rawName: 'credit',
        details: { onlyExactVersion: 'old' },
      },
    };
    expect(sourcePackage(p).records[0]!.content.executionDeclaration).toEqual(
      p.records[0]!.content.executionDeclaration,
    );
  });
  it('does not claim an LCM integration from source AEO fields', () => {
    const p = fixture();
    (p.records[0]!.content.futureLcmLinks![0] as any).integrationStatus =
      'CONNECTED';
    expect(() => sourcePackage(p)).toThrow(
      'TDMS_LCM_CONFIGURATION_AUTHORITY_NOT_CONNECTED',
    );
  });
  it('OR/VR raw codes remain raw without manufacturing controlled mapping', () => {
    const p = fixture();
    p.records[0]!.state = { rawCode: 'VR', rawName: 'OR' };
    expect(sourcePackage(p).records[0]!.state).toEqual({
      rawCode: 'VR',
      rawName: 'OR',
    });
  });
  it('candidate generic replaces/completion needs explicit scope and basis', () => {
    const p = fixture();
    p.relations = [
      {
        sourceRelationId: 'r',
        expectedHeadAssertionRef: null,
        rawKind: 'supersedes',
        controlledKind: 'VERSION_CHANGE',
        from: { kind: 'PACKAGE_RECORD', itemId: 'a' },
        to: {
          kind: 'UNRESOLVED',
          rawIdentity: 'old',
          versionGap: 'unknown version',
        },
        authority: 'CANDIDATE_ONLY',
        selector: 'row',
        observedAt: p.observedAt,
        coverage: p.coverage,
        scope: {},
        completionEffect: 'OLD_COMPLETION_RECOGNIZED',
        changeClass: 'REPLACES',
        rawFields: {},
      },
    ];
    const parsed = sourcePackage(p);
    expect(parsed.relations[0]!.changeClass).toBe('REPLACES');
    expect(packageGaps(parsed)).toEqual(
      expect.arrayContaining([
        'CANDIDATE_REVISION_RULE_NOT_SOURCE_AUTHORITY',
        'REVISION_RULE_EXACT_ENDPOINT_NOT_VERIFIED',
        'REVISION_RULE_SCOPE_NOT_VERIFIED',
      ]),
    );
  });
  it('source non-atomic readback and failures remain explicit gaps', () => {
    const p = fixture();
    p.coverage.readback = 'NON_ATOMIC';
    p.readFailures = [
      { sourceRecordId: 'X', code: 'FAILED', detail: 'missing' },
    ];
    expect(packageGaps(sourcePackage(p))).toEqual(
      expect.arrayContaining([
        'SOURCE_READBACK_NOT_ATOMIC_VERIFIED',
        'SOURCE_READ_FAILURES',
      ]),
    );
  });
  it('rejects small-package body oversize without altering bootstrap', () => {
    const p = fixture();
    p.records[0]!.rawFields = { huge: 'x'.repeat(513 * 1024) };
    expect(() => sourcePackage(p)).toThrow('TDMS_SMALL_PACKAGE_LIMIT');
  });
});
