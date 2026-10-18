import { prepareTdmsDailySourceImport as prepare } from '../../../server/modules/tdms-source/tdms-daily-metadata-contract';
import { adaptTdmsDailySource as adapt } from '../../../server/modules/tdms-source/tdms-daily-source-adapter';
import {
  canonical,
  hash,
} from '../../../server/modules/tdms-source/tdms-source.validation';
import { actor } from './tdms-fixtures';
import { SB_NATIVE_LAYOUT } from '../../../server/modules/tdms-source/tdms-reviewed-sb-native-layout';
import { sbProof } from './tdms-reviewed-sb-0-2-73.fixture';
import type {
  KeyOrderLayoutFrame,
  KeyOrderLayoutPanel,
} from './tdms-object-key-order-0-2-85.fixture';
import {
  keyOrderEnvelope,
  reorderObjectKeys,
  minimalLayoutKeyOrder,
  keyOrderService,
  sealKeyOrderRaw,
} from './tdms-object-key-order-0-2-85.fixture';

function expectLayout400(action: () => unknown) {
  try {
    action();
  } catch (error) {
    expect(error).toMatchObject({
      code: 'TDMS_COMPLETE_SB_NATIVE_LAYOUT_INVALID',
      statusCode: 400,
    });
    return;
  }
  throw new Error('Expected the actual native-layout validator to reject');
}

const invalidFrames: [string, (frame: KeyOrderLayoutFrame) => void][] = [
  ['extra grid key', (f) => Reflect.set(f.grids[0], 'unreviewed', null)],
  ['missing grid key', (f) => Reflect.deleteProperty(f.grids[0], 'gridId')],
  [
    'extra nested column key',
    (f) => Reflect.set(f.grids[0].columns[0], 'unreviewed', true),
  ],
  [
    'missing nested column key',
    (f) => Reflect.deleteProperty(f.grids[0].columns[0], 'actualLabel'),
  ],
  [
    'changed nested value',
    (f) => Reflect.set(f.grids[0].columns[0], 'actualLabel', 'unknown'),
  ],
  [
    'changed nested type',
    (f) => Reflect.set(f.grids[0].columns[0], 'actualLabel', 7),
  ],
  [
    'array changed to object',
    (f) => Reflect.set(f.grids[0], 'columns', { ...f.grids[0].columns }),
  ],
  ['changed array length', (f) => f.grids[0].columns.pop()],
  ['changed array order', (f) => f.grids[0].columns.reverse()],
  ['null array member', (f) => Reflect.set(f.grids[0].columns, 0, null)],
];

describe('complete Source0.2.85 @14 exact object-key-independent Host consumers, synthetic evidence', () => {
  it.each(['SB', 'SL'] as const)(
    'preserves actual %s prepare/adapter admission for recursively reordered object keys',
    (scope) => {
      const original = keyOrderEnvelope(scope),
        expected = prepare(original),
        originalNative = adapt(original);
      for (const descending of [false, true]) {
        const reordered = reorderObjectKeys(original, descending),
          wire = JSON.stringify(reordered);
        expect(reordered).toEqual(original);
        expect(wire).not.toBe(JSON.stringify(original));
        expect(canonical(reordered)).toBe(canonical(original));
        expect(hash(reordered.package)).toBe(hash(original.package));
        expect(prepare(reordered).sourceRefs).toEqual(expected.sourceRefs);
        expect(prepare(reordered).payloadDigest).toBe(expected.payloadDigest);
        const native = adapt(reordered);
        expect(native.outputDigest).toBe(originalNative.outputDigest);
        expect(
          native.output.nativePackage.records[0].formalDocumentArtifactMemberId,
        ).toBeNull();
        expect(reordered.requestId).toBe(original.requestId);
        expect(reordered.package.records[0].snapshotId).toBe(
          original.package.records[0].snapshotId,
        );
        expect(JSON.stringify(reordered)).toBe(wire);
      }
    },
  );
  it('accepts the retained minimal four-grid-object property-order permutation', () => {
    const original = keyOrderEnvelope(),
      before = prepare(original),
      reordered = minimalLayoutKeyOrder(JSON.parse(JSON.stringify(original)));
    expect(reordered).toEqual(original);
    expect(prepare(reordered).sourceRefs).toEqual(before.sourceRefs);
  });
  it('accepts independently reordered before/after and read objects without changing their raw values', () => {
    const env = keyOrderEnvelope(),
      expected = prepare(env),
      native = adapt(env);
    const panel = sbProof(env).reads[0].sbNativeLayoutEvidence.panels.find(
      (value: KeyOrderLayoutPanel) => value.before.grids.length > 0,
    );
    panel.before = reorderObjectKeys(panel.before, true);
    expect(env.requestId).toBe(expected.envelope.requestId);
    expect(prepare(env).payloadDigest).toBe(expected.payloadDigest);
    expect(adapt(env).outputDigest).toBe(native.outputDigest);
  });
  it.each(invalidFrames)(
    'rejects %s in the actual modified validator and actual prepare/adapter, rather than only at the envelope hash',
    (_name, mutate) => {
      const env = keyOrderEnvelope();
      for (const read of sbProof(env).reads) {
        const context = { scopeId: 'SB', owner: read.owner, read };
        expect(SB_NATIVE_LAYOUT.validate(context)).toBe(true);
        const panel = read.sbNativeLayoutEvidence.panels.find(
          (value: KeyOrderLayoutPanel) => value.before.grids.length > 0,
        );
        mutate(panel.before);
        mutate(panel.after);
        expectLayout400(() => SB_NATIVE_LAYOUT.validate(context));
      }
      // Do not call the snapshot projection in arrange. The invalid raw proof
      // reaches the production validator and its precise 400 through both APIs.
      sealKeyOrderRaw(env);
      expectLayout400(() => prepare(env));
      expectLayout400(() => adapt(env));
    },
  );
  it.each(['SB', 'SL'] as const)(
    'preserves %s POST/readback/replay/SourceRefs through the actual service and committed-row ordering port',
    async (scope) => {
      const env = keyOrderEnvelope(scope),
        s = keyOrderService(env),
        expectedRefs = prepare(env).sourceRefs;
      const receipt = await s.service.importDailyMetadata(actor(), env);
      expect(Object.keys(receipt)).toHaveLength(10);
      expect(receipt.sourceRefs).toEqual(expectedRefs);
      expect(receipt.documentVersionMappings).toEqual([]);
      expect(
        (await s.service.readDailyMetadataImport(actor(), env.requestId))
          .package,
      ).toEqual(env.package);
      for (const ref of receipt.sourceRefs)
        expect(await s.service.readDailySourceRef(actor(), ref)).toBeDefined();
      expect(
        await s.service.importDailyMetadata(
          actor(),
          reorderObjectKeys(env, true),
        ),
      ).toEqual(receipt);
      expect(s.repository.state.captures).toHaveLength(1);
      expect(s.artifacts.acquire).not.toHaveBeenCalled();
      expect(s.documents.assertRead).not.toHaveBeenCalled();
      s.permissions.read = false;
      await expect(
        s.service.readDailyMetadataImport(actor(), env.requestId),
      ).rejects.toMatchObject({
        code: 'SYNTHETIC_SOURCE_READ_REVOKED',
        statusCode: 403,
      });
    },
  );
});
