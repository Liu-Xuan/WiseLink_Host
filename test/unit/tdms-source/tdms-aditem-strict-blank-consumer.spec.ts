import producer from '../../fixtures/tdms-source/aditem-strict-blank-producer-qualified.synthetic.json';
import { prepareTdmsDailySourceImport } from '../../../server/modules/tdms-source/tdms-daily-metadata-contract';
import { adaptTdmsDailySource } from '../../../server/modules/tdms-source/tdms-daily-source-adapter';
import { validateReviewedAdItemRead } from '../../../server/modules/tdms-source/tdms-reviewed-ad-item-native-model';
import { validateCompleteOwnedObservation } from '../../../server/modules/tdms-source/tdms-complete-owned-source.validation';
import { TdmsSourceService } from '../../../server/modules/tdms-source/tdms-source.service';
import { HostDecisionTdmsSourceAuthorization } from '../../../server/modules/tdms-source/tdms-source.authorization';
import { hash } from '../../../server/modules/tdms-source/tdms-source.validation';
import { MemoryTdmsRepository, nativeScope } from './tdms-memory-double';
import { syntheticAdItem } from './tdms-metadata-aditem.fixture';
import { syntheticItemQuery } from './tdms-h-item-query.fixture';
import { actor } from './tdms-fixtures';

type Raw = Record<string, unknown>;
function object(value: unknown): Raw {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Expected fixture object');
  return value as Raw;
}
function array(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw new Error('Expected fixture array');
  return value;
}
function envelope(): Raw {
  return object(JSON.parse(JSON.stringify(producer.envelope)));
}
function record(env: Raw): Raw {
  return object(array(object(env.package).records)[0]);
}
function proof(env: Raw): Raw {
  return object(object(record(env).rawFields).completeOwnedSource);
}
function reads(env: Raw): Raw[] {
  return array(proof(env).reads).map(object);
}
function observation(env: Raw): Raw {
  const p: Raw = proof(env);
  return {
    schemaVersion: p.schemaVersion,
    requestedCriteria: p.requestedCriteria,
    documentIdentity: p.documentIdentity,
    nativeReloadProvenance: p.nativeReloadProvenance,
    reads: p.reads,
  };
}
function efr(read: Raw): Raw {
  return object(
    array(read.relationTables).find(
      (t: unknown) => object(t).gridId === 'document.EFRDoc.list',
    ),
  );
}
function eachFrame(table: Raw, edit: (frame: Raw) => void): void {
  const p: Raw = object(table.relatedSurfaceEvidence);
  edit(object(p.before));
  edit(object(p.after));
  for (const pair of array(p.windowPairs)) {
    edit(object(object(pair).before));
    edit(object(object(pair).after));
  }
}
function blank(frame: Raw): Raw {
  return object(object(frame.nativeQuery).strictBlankEvidence);
}
function cell(frame: Raw): Raw {
  return object(array(blank(frame).cells)[0]);
}
function assertRead(read: Raw): unknown {
  return validateReviewedAdItemRead({
    scopeId: 'AD_ITEM',
    owner: read.owner,
    read,
  });
}
const mutations: Array<[string, (frame: Raw) => void]> = [
  [
    'absent proof',
    (f) => {
      delete object(f.nativeQuery).strictBlankEvidence;
    },
  ],
  [
    'foreign owner',
    (f) => {
      blank(f).ownerSourceRecordId = 'OR:wt.change2.WTChangeActivity2:1';
    },
  ],
  [
    'forged version',
    (f) => {
      object(blank(f).ownerSourceVersion).rawRevision = 'forged';
    },
  ],
  [
    'foreign own state',
    (f) => {
      blank(f).ownStateRaw = 'Approved';
    },
  ],
  [
    'changed modified',
    (f) => {
      blank(f).ownerSourceModifiedRaw =
        String(blank(f).ownerSourceModifiedRaw) + ' ';
    },
  ],
  [
    'wrong occurrence',
    (f) => {
      cell(f).occurrenceId = 'document.EFRDoc.list:ROW3';
    },
  ],
  [
    'wrong index',
    (f) => {
      cell(f).globalIndex = 3;
    },
  ],
  [
    'wrong column',
    (f) => {
      cell(f).nativeColumnToken = 'comments';
    },
  ],
  [
    'wrong locator',
    (f) => {
      cell(f).cellLocator = String(cell(f).cellLocator) + ' > span';
    },
  ],
  [
    'non-NBSP raw text',
    (f) => {
      cell(f).rawText = ' ';
    },
  ],
  [
    'extra native node',
    (f) => {
      cell(f).cellInnerHTML =
        String(cell(f).cellInnerHTML) + '<span>hidden</span>';
    },
  ],
  [
    'truncated proof',
    (f) => {
      cell(f).truncated = true;
    },
  ],
  [
    'wrong raw length',
    (f) => {
      cell(f).observedTotalCodepoints = 0;
    },
  ],
  [
    'incomplete proof roster',
    (f) => {
      array(blank(f).cells).pop();
    },
  ],
];

describe('Source-produced AD strict blanks through the real Host consumers', () => {
  it('accepts the separate Source-produced seven-blank case without reading or adopting the nonempty unknown opinion', () => {
    const env: Raw = object(
      JSON.parse(JSON.stringify(producer.mixed.envelope)),
    );
    const before: string = JSON.stringify(env);
    expect(hash(record(env))).toBe(producer.mixed.expected.recordSha256);
    expect(hash(env.package)).toBe(producer.mixed.expected.packageSha256);
    expect(record(env).snapshotId).toBe(producer.mixed.expected.snapshotId);
    expect(prepareTdmsDailySourceImport(env).envelope).toEqual(env);
    expect(adaptTdmsDailySource(env).output.nativePackage.coverage.status).toBe(
      'PARTIAL',
    );
    for (const read of reads(env)) {
      const table: Raw = efr(read);
      expect(assertRead(read)).toBe(true);
      expect(
        object(array(object(array(table.rows)[0]).cells)[10]),
      ).toMatchObject({
        state: 'NOT_READ',
        rawValue: null,
        observedTotalCodepoints: 0,
      });
      eachFrame(table, (frame: Raw) => {
        expect(array(blank(frame).cells)).toHaveLength(7);
      });
    }
    expect(JSON.stringify(env)).not.toContain(
      'SYNTHETIC UNKNOWN EFR ROW OPINION',
    );
    expect(JSON.stringify(env)).toBe(before);
  });

  it('accepts the independently produced remounted payload without changing Source identity or raw proof', () => {
    const env: Raw = envelope();
    const before: string = JSON.stringify(env);
    expect(hash(record(env))).toBe(producer.expected.recordSha256);
    expect(hash(env.package)).toBe(producer.expected.packageSha256);
    expect(record(env).snapshotId).toBe(producer.expected.snapshotId);
    const prepared = prepareTdmsDailySourceImport(env);
    expect(prepared.envelope).toEqual(env);
    const adapted = adaptTdmsDailySource(env);
    expect(adapted.envelope).toEqual(env);
    expect(adapted.output.nativePackage.coverage.status).toBe('PARTIAL');
    expect(
      adapted.output.nativePackage.records[0].relatedDocumentVersionIds,
    ).toEqual([]);
    expect(adapted.output.nativePackage.records[0].sourceVersion).toEqual(
      record(env).sourceVersion,
    );
    expect(proof(env).targetOccurrences).toEqual(
      producer.expected.targetOccurrences,
    );
    const bodyIds: unknown[] = reads(env)
      .map(
        (r: Raw) =>
          object(
            object(object(efr(r).relatedSurfaceEvidence).after).nativeQuery,
          ).efrBody,
      )
      .map((b: unknown) => object(object(b).body).id);
    expect(bodyIds).toEqual(producer.expected.bodyIds);
    for (const read of reads(env)) expect(assertRead(read)).toBe(true);
    expect(JSON.stringify(env)).toBe(before);
  });

  it('imports and reads all exact refs with independent test grants, while retaining partial/candidate meaning', async () => {
    const env: Raw = envelope();
    const claims = adaptTdmsDailySource(env).memberClaims;
    const repository = new MemoryTdmsRepository();
    let allowed: boolean = true;
    const authority = new HostDecisionTdmsSourceAuthorization(
      async () => [
        { scope: nativeScope, permissionRevision: 'strict-blank-test-1' },
      ],
      async ({ grant }) => ({
        ...grant,
        authorityRef: 'independent-offline-import',
        captureRetentionAllowed: true,
        nativeProjectionAllowed: true,
        permittedMembers: claims,
      }),
      async ({ grant }) => ({
        ...grant,
        authorityRef: 'independent-offline-read',
        retainedCaptureReadAllowed: true,
        permittedMembers: allowed
          ? claims
          : { records: [], artifacts: [], relationIds: [] },
      }),
    );
    const acquire = jest.fn();
    const documents = { assertRead: jest.fn() };
    const service = new TdmsSourceService(
      repository,
      authority,
      { acquire },
      documents,
    );
    const receipt = await service.importDailyMetadata(actor(), env);
    expect(receipt.status).toBe('IMPORTED');
    expect(receipt.sourceRefs).toEqual(producer.expected.sourceRefs);
    expect(receipt.documentVersionMappings).toEqual([]);
    const saved = await service.readDailyMetadataImport(
      actor(),
      String(env.requestId),
    );
    expect(saved.package).toEqual(env.package);
    expect(saved.receipt).toEqual(receipt);
    for (const ref of producer.expected.sourceRefs) {
      const value = await service.readDailySourceRef(actor(), ref);
      expect(value.sourceRef).toBe(ref);
    }
    expect(
      repository.state.revisions[0].record.relatedDocumentVersionIds,
    ).toEqual([]);
    expect(repository.state.revisions[0].record.coverage.status).toBe(
      'PARTIAL',
    );
    expect(acquire).not.toHaveBeenCalled();
    allowed = false;
    await expect(
      service.readDailySourceRef(actor(), producer.expected.sourceRefs[0]),
    ).rejects.toThrow();
  });

  it.each(mutations)(
    'rejects %s in the actual AD reader and package consumer',
    (_name, mutate) => {
      const env: Raw = envelope();
      for (const read of reads(env)) eachFrame(efr(read), mutate);
      expect(() => assertRead(reads(env)[0])).toThrow();
      expect(() => prepareTdmsDailySourceImport(env)).toThrow();
    },
  );

  it('rejects a blank renderer changing in only one settled read', () => {
    const env: Raw = envelope();
    const p: Raw = object(efr(reads(env)[0]).relatedSurfaceEvidence);
    const before: Raw = object(object(array(p.windowPairs)[0]).before);
    cell(before).rawText = 'changed';
    expect(() => assertRead(reads(env)[0])).toThrow();
    expect(() => prepareTdmsDailySourceImport(env)).toThrow();
  });

  it.each(['Estimating', 'In Work'])(
    'does not turn %s into an admissible own opinion',
    (state: string) => {
      const env: Raw = envelope();
      for (const read of reads(env)) object(read.owner).stateRaw = state;
      expect(() =>
        validateCompleteOwnedObservation(
          observation(env),
          proof(env).requestedCriteria,
        ),
      ).toThrow(
        state === 'Estimating'
          ? 'TDMS_ESTIMATING_STATE_ONLY_REQUIRED'
          : 'TDMS_OPINION_STATE_NOT_ELIGIBLE',
      );
    },
  );

  it.each<Array<[string, () => unknown]>[number]>([
    ['metadata/NOT_READ', syntheticAdItem],
    ['details-query proof', syntheticItemQuery],
  ])('keeps the historical %s payload unchanged', (_kind, make) => {
    const legacy: unknown = make();
    const before: string = JSON.stringify(legacy);
    expect(prepareTdmsDailySourceImport(legacy).envelope).toEqual(legacy);
    expect(JSON.stringify(legacy)).toBe(before);
  });
});
