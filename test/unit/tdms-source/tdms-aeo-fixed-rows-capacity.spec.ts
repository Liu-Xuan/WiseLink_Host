import producerGolden from '../../fixtures/tdms-source/aeo-models-producer-qualified.synthetic.json';
import {
  parseReviewedAeoOwnBusinessNumber,
  validateReviewedAeoBusinessNumberEvidence,
} from '../../../server/modules/tdms-source/tdms-reviewed-aeo-business-version';
import { validateRelatedStatusFixedRowSlotEvidence } from '../../../server/modules/tdms-source/tdms-related-status-fixed-row-slots';
import {
  COMPLETE_OWN_MAX_NODES,
  COMPLETE_OWN_OBSERVATION_MAX_BYTES,
  COMPLETE_OWN_PACKAGE_MAX_BYTES,
  COMPLETE_OWN_REQUEST_MAX_BYTES,
  usesCompleteOwnedPackageLimits,
  validateCompleteOwnedOwner,
} from '../../../server/modules/tdms-source/tdms-complete-owned-source.validation';
import {
  prepareTdmsDailySourceImport,
  prepareTdmsDailyMetadataImport,
} from '../../../server/modules/tdms-source/tdms-daily-metadata-contract';
import { adaptTdmsDailySource } from '../../../server/modules/tdms-source/tdms-daily-source-adapter';
import {
  canonical,
  sourcePackage,
} from '../../../server/modules/tdms-source/tdms-source.validation';
import {
  syntheticAeoEnvelope,
  aeoProof,
  resealAeo,
  nodes,
} from './tdms-aeo-capacity.fixture';
import {
  copyComplete,
  syntheticCompleteEnvelope,
  withCompleteRelation,
} from './tdms-complete-owned.fixture';

const mutateReads = (
  env: ReturnType<typeof syntheticCompleteEnvelope>,
  mutate: (read: any) => void,
) => {
  for (const read of aeoProof(env).reads) mutate(read);
  return resealAeo(env);
};
const tableOf = (read: any) => read.relationTables[0];
const businessField = (read: any) =>
  read.fields.find((f: any) => f.value.actualLabel === 'EO编号:');

describe('AEO own number and fixed slots, current code-only models', () => {
  it('matches two SHA-qualified producer pure validators on independent synthetic literals', () => {
    expect(producerGolden.syntheticOnly).toBe(true);
    const b = producerGolden.business;
    expect(
      parseReviewedAeoOwnBusinessNumber({
        scopeId: 'AEO',
        owner: b.owner,
        value: b.owner.businessVersionEvidence,
      }),
    ).toEqual(b.expectedVersion);
    expect(
      validateReviewedAeoBusinessNumberEvidence({
        scopeId: 'AEO',
        owner: b.owner,
        fields: b.fields,
      }),
    ).toBe(b.expectedValid);
    const s = producerGolden.slots;
    expect(
      validateRelatedStatusFixedRowSlotEvidence(s.evidence, {
        scopeId: 'AEO',
        owner: s.owner,
        table: s.table,
      }),
    ).toBe(s.expectedValid);
  });

  it('retains full own raw number and distinct N technical/R business versions through actual DTO projections', () => {
    const env = syntheticAeoEnvelope(),
      inputBefore = copyComplete(env);
    const prepared = prepareTdmsDailySourceImport(env);
    const adapted = adaptTdmsDailySource(env);
    expect(env).toEqual(inputBefore);
    expect(prepared.authority).toBe('NOT_GRANTED_BY_PREPARATION');
    const native = sourcePackage(adapted.output.nativePackage);
    const p = native.records[0].rawFields.completeOwnedSource as any;
    expect(native.records[0].businessVersion?.rawRevision).toBe('R17');
    expect(native.records[0].sourceVersion).toEqual({
      rawRevision: 'N',
      rawIteration: '3',
      confirmation: 'SOURCE_DECLARED',
    });
    expect(p.reads[1].owner.businessVersionEvidence.rawValue).toBe(
      env.package.records[0].number + '-R17',
    );
    expect(p.reads[1].relationTables[0].nativeRowSlotEvidence).toEqual(
      aeoProof(env).reads[1].relationTables[0].nativeRowSlotEvidence,
    );
    expect(native.coverage.status).toBe('PARTIAL');
    expect(native.coverage.gaps).toContain('COMPLETION_CERTIFICATE_NOT_ISSUED');
    expect(native.artifacts).toEqual([]);
  });

  it('parses whitespace without trimming retained raw evidence', () => {
    const env = mutateReads(syntheticAeoEnvelope(), (read) => {
      const v = read.owner.businessVersionEvidence;
      v.rawValue = '  ' + v.rawValue + '  ';
      v.observedTotalCodepoints = [...v.rawValue].length;
      businessField(read).value = copyComplete(v);
    });
    const prepared = prepareTdmsDailySourceImport(env);
    expect(
      prepared.envelope.package.records[0].businessVersion?.rawRevision,
    ).toBe('R17');
    expect(
      aeoProof(prepared.envelope).reads[1].owner.businessVersionEvidence
        .rawValue,
    ).toMatch(/^  .*  $/u);
  });

  it('keeps the shared classification owner technical/business semantics without adding classifier fields', () => {
    const read = aeoProof(syntheticAeoEnvelope()).reads[0];
    const input = {
      ...aeoProof(syntheticAeoEnvelope()).requestedCriteria,
      scopeId: 'EO',
    };
    expect(() =>
      validateCompleteOwnedOwner(read.owner, input, { classification: true }),
    ).not.toThrow();
  });

  it.each([
    [
      'business suffix mismatch',
      (r: any) => {
        r.owner.businessVersion.rawRevision = 'R18';
      },
    ],
    [
      'borrowed number',
      (r: any) => {
        r.owner.businessVersionEvidence.rawValue = 'FOREIGN-OWNER-R17';
        r.owner.businessVersionEvidence.observedTotalCodepoints = 17;
        businessField(r).value = copyComplete(r.owner.businessVersionEvidence);
      },
    ],
    [
      'number lost',
      (r: any) => {
        r.owner.businessVersionEvidence.rawValue = 'R17';
        r.owner.businessVersionEvidence.observedTotalCodepoints = 3;
        businessField(r).value = copyComplete(r.owner.businessVersionEvidence);
      },
    ],
    [
      'field is input',
      (r: any) => {
        businessField(r).nativeControl.tag = 'INPUT';
      },
    ],
    [
      'field is expected placeholder',
      (r: any) => {
        businessField(r).labelOrigin = 'PROFILE_EXPECTED';
      },
    ],
    [
      'field is outside primary section',
      (r: any) => {
        businessField(r).sectionId = 'section-own';
      },
    ],
    [
      'field ID drift',
      (r: any) => {
        businessField(r).fieldId = 'synthetic-drift';
        const roster = r.rosterEvidence.structuralRosters[1];
        roster.before.fieldIds[0] = roster.after.fieldIds[0] =
          'synthetic-drift';
      },
    ],
    [
      'foreign native subtype',
      (r: any) => {
        r.owner.scopeEvidence.engineeringSubtype = 'EO';
      },
    ],
    [
      'technical revision reused as business',
      (r: any) => {
        r.owner.sourceVersion.rawRevision = 'R17';
      },
    ],
    [
      'duplicate number caption',
      (r: any) => {
        const f = r.fields[1];
        f.value = {
          ...f.value,
          state: 'VALUE',
          actualLabel: 'EO编号:',
          rawValue: r.owner.businessVersionEvidence.rawValue,
          observedTotalCodepoints: [...r.owner.businessVersionEvidence.rawValue]
            .length,
        };
      },
    ],
  ])(
    'rejects %s after both reads and outer identities are re-sealed',
    (_, mutate) => {
      const env = mutateReads(syntheticAeoEnvelope(), mutate);
      expect(() => prepareTdmsDailySourceImport(env)).toThrow();
    },
  );

  it.each([
    [
      'missing slot proof',
      (t: any) => {
        delete t.nativeRowSlotEvidence;
      },
    ],
    [
      'unknown proof key',
      (t: any) => {
        t.nativeRowSlotEvidence.invented = true;
      },
    ],
    [
      'model version drift',
      (t: any) => {
        t.nativeRowSlotEvidence.modelRevision += '-wrong';
      },
    ],
    [
      'column token drift',
      (t: any) => {
        t.nativeRowSlotEvidence.columns[0].nativeColumnToken = 'not-type-icon';
      },
    ],
    [
      'roster shortened',
      (t: any) => {
        t.nativeRowSlotEvidence.windows[0].before.slots.pop();
      },
    ],
    [
      'unstable after roster',
      (t: any) => {
        t.nativeRowSlotEvidence.windows[0].after.slots[0][1] = 99;
      },
    ],
    [
      'duplicate node identity',
      (t: any) => {
        for (const side of ['before', 'after'])
          t.nativeRowSlotEvidence.windows[0][side].slots[1][1] = 1;
      },
    ],
    [
      'layout changes between windows',
      (t: any) => {
        for (const side of ['before', 'after'])
          t.nativeRowSlotEvidence.windows[1][side].slots[0][1] = 99;
      },
    ],
    [
      'visible row lacks rendered cells',
      (t: any) => {
        for (const side of ['before', 'after'])
          t.nativeRowSlotEvidence.windows[0][side].slots[0][4] = 0;
      },
    ],
    [
      'row link hash changed',
      (t: any) => {
        t.nativeRowSlotEvidence.windows[0].referenceBindings[0].sourceLinksSha256 =
          '0'.repeat(64);
      },
    ],
    [
      'foreign table owner',
      (t: any) => {
        t.ownerSourceRecordId = 'OR:wt.epm.EPMDocument:999999';
      },
    ],
    [
      'table version drift',
      (t: any) => {
        t.ownerSourceVersion.rawIteration = '4';
      },
    ],
  ])('rejects %s without discarding the row or proof', (_, mutate) => {
    const env = mutateReads(syntheticAeoEnvelope(), (r) => mutate(tableOf(r)));
    expect(() => prepareTdmsDailySourceImport(env)).toThrow();
  });

  it('keeps previous native/index relation paths when the fixed anonymous ROW trigger does not apply', () => {
    expect(() =>
      adaptTdmsDailySource(
        withCompleteRelation(syntheticCompleteEnvelope('EO')),
      ),
    ).not.toThrow();
  });
});

describe('Complete1 scoped lossless capacity chain', () => {
  it('passes full112 rows beyond old node/observation limits through preparation/native/re-read projections', () => {
    const env = syntheticAeoEnvelope(112),
      before = copyComplete(env);
    const proof = aeoProof(env),
      observation = {
        schemaVersion: proof.schemaVersion,
        requestedCriteria: proof.requestedCriteria,
        documentIdentity: proof.documentIdentity,
        nativeReloadProvenance: proof.nativeReloadProvenance,
        reads: proof.reads,
      };
    expect(nodes(env)).toBeGreaterThan(50000);
    expect(nodes(env)).toBeLessThan(COMPLETE_OWN_MAX_NODES);
    expect(Buffer.byteLength(canonical(observation))).toBeGreaterThan(
      850 * 1024,
    );
    expect(Buffer.byteLength(canonical(observation))).toBeLessThanOrEqual(
      COMPLETE_OWN_OBSERVATION_MAX_BYTES,
    );
    expect(Buffer.byteLength(canonical(env.package))).toBeLessThan(
      COMPLETE_OWN_PACKAGE_MAX_BYTES,
    );
    const prepared = prepareTdmsDailySourceImport(env);
    const a = adaptTdmsDailySource(prepared.envelope);
    const again = adaptTdmsDailySource(JSON.parse(JSON.stringify(env)));
    expect(a.output).toEqual(again.output);
    expect(env).toEqual(before);
    expect(a.output.nativePackage.records).toHaveLength(1);
    expect(a.output.nativePackage.relations).toHaveLength(112);
    const retained = a.output.nativePackage.records[0].rawFields
      .completeOwnedSource as any;
    for (const read of retained.reads) {
      expect(read.relationTables[0].rows).toHaveLength(112);
      expect(read.relationTables[0].rows).toEqual(
        aeoProof(env).reads[0].relationTables[0].rows,
      );
    }
  });

  it.each(['mode', 'schemaVersion', 'profileRevision'])(
    'wrong %s cannot acquire the wider node budget',
    (field) => {
      const env = syntheticAeoEnvelope(112);
      aeoProof(env)[field] = 'WRONG';
      expect(usesCompleteOwnedPackageLimits(env.package)).toBe(false);
      expect(() => prepareTdmsDailySourceImport(env)).toThrow(
        'TDMS_DAILY_LIMIT',
      );
    },
  );

  it('keeps the metadata-only validator narrow for a large Complete1-shaped package', () => {
    expect(() =>
      prepareTdmsDailyMetadataImport(syntheticAeoEnvelope(112)),
    ).toThrow('TDMS_DAILY_LIMIT');
  });

  it('rejects more than100k nodes in an exact Complete1-marked envelope', () => {
    const env = syntheticAeoEnvelope();
    (env.package.query.requestedCriteria as any).padding = Array.from(
      { length: 12 },
      () => Array(8500).fill(null),
    );
    expect(nodes(env)).toBeGreaterThan(100000);
    expect(() => prepareTdmsDailySourceImport(env)).toThrow('TDMS_DAILY_LIMIT');
  });

  it('never executes an accessor while selecting the package budget', () => {
    const env = syntheticAeoEnvelope(),
      getter = jest.fn(() => env.package);
    const raw = { requestId: env.requestId };
    Object.defineProperty(raw, 'package', { enumerable: true, get: getter });
    expect(() => prepareTdmsDailySourceImport(raw)).toThrow(
      'TDMS_DAILY_ACCESSOR_REJECTED',
    );
    expect(getter).not.toHaveBeenCalled();
    const recordsGetter = jest.fn(() => env.package.records),
      pkg = {};
    Object.defineProperty(pkg, 'records', {
      enumerable: true,
      get: recordsGetter,
    });
    expect(usesCompleteOwnedPackageLimits(pkg)).toBe(false);
    expect(recordsGetter).not.toHaveBeenCalled();
  });

  it('retains secret/identity and depth rejection under the wider mode', () => {
    const env = syntheticAeoEnvelope();
    (env.package.query.requestedCriteria as any).actorUserId =
      'synthetic-untrusted';
    expect(() => prepareTdmsDailySourceImport(env)).toThrow(
      'TDMS_DAILY_RESERVED_CLAIM_REJECTED',
    );
    delete (env.package.query.requestedCriteria as any).actorUserId;
    (env.package.query.requestedCriteria as any).hidden =
      'Cookie: synthetic-not-a-real-secret';
    expect(() => prepareTdmsDailySourceImport(env)).toThrow(
      'TDMS_DAILY_SENSITIVE_VALUE_REJECTED',
    );
    delete (env.package.query.requestedCriteria as any).hidden;
    let nested: any = null;
    for (let i = 0; i < 26; i++) nested = { next: nested };
    (env.package.query.requestedCriteria as any).nested = nested;
    expect(() => prepareTdmsDailySourceImport(env)).toThrow('TDMS_DAILY_LIMIT');
  });

  it('keeps the2MiB core despite the fixed request wrapper allowance', () => {
    const env = syntheticAeoEnvelope();
    const padding: string[] = [];
    (env.package.query.requestedCriteria as any).padding = padding;
    while (
      Buffer.byteLength(canonical(env.package)) <
      COMPLETE_OWN_PACKAGE_MAX_BYTES - 100000
    )
      padding.push('x'.repeat(90000));
    padding.push('');
    padding[padding.length - 1] = 'x'.repeat(
      COMPLETE_OWN_PACKAGE_MAX_BYTES +
        1 -
        Buffer.byteLength(canonical(env.package)),
    );
    expect(Buffer.byteLength(canonical(env.package))).toBe(
      COMPLETE_OWN_PACKAGE_MAX_BYTES + 1,
    );
    expect(Buffer.byteLength(canonical(env))).toBeLessThanOrEqual(
      COMPLETE_OWN_REQUEST_MAX_BYTES,
    );
    expect(() => prepareTdmsDailySourceImport(env)).toThrow('TDMS_DAILY_LIMIT');
  });
});
