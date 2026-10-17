import { prepareTdmsDailySourceImport as prepare } from '../../../server/modules/tdms-source/tdms-daily-metadata-contract';
import { adaptTdmsDailySource as adapt } from '../../../server/modules/tdms-source/tdms-daily-source-adapter';
import { completeContentIdentityProjection } from '../../../server/modules/tdms-source/tdms-complete-owned-source.validation';
import { REVIEWED_SB_HISTORY_MODEL } from '../../../server/modules/tdms-source/tdms-reviewed-sb-history-purpose';
import { REVIEWED_SB_NOTEBOOK_MODEL } from '../../../server/modules/tdms-source/tdms-reviewed-sb-notebook-purpose';
import { TdmsSourceService } from '../../../server/modules/tdms-source/tdms-source.service';
import { HostDecisionTdmsSourceAuthorization } from '../../../server/modules/tdms-source/tdms-source.authorization';
import { MemoryTdmsRepository, nativeScope } from './tdms-memory-double';
import { actor } from './tdms-fixtures';
import { sbProof, sealSb } from './tdms-reviewed-sb-0-2-73.fixture';
import {
  SB_TIMELINE_PATHS,
  syntheticTimelineCapture,
  timelineTab,
} from './tdms-reviewed-history-0-2-76.fixture';
import {
  syntheticNativeNotebook,
  syntheticNotebookOnly,
  notebookTable,
  treeMtime,
  sealNotebookRaw,
  syntheticSbCaption,
  canonicalCaption,
  alternateCaption,
  documentCaption,
  captionTree,
  setReadCaption,
  changeBusinessTitle,
  changeTechnicalVersion,
  changeNativeTarget,
} from './tdms-reviewed-source-0-2-83.fixture';

const consumers = [prepare, adapt];
function rejectRaw(
  env: ReturnType<typeof syntheticNativeNotebook>,
  code?: string,
) {
  sealNotebookRaw(env);
  const raw = JSON.stringify(env);
  for (const consume of consumers) {
    let error: unknown;
    try {
      consume(env);
    } catch (caught) {
      error = caught;
    }
    expect(error).toMatchObject({
      statusCode: 400,
      code: code ?? expect.stringMatching(/^TDMS_/u),
    });
    expect(error).not.toBeInstanceOf(TypeError);
  }
  expect(JSON.stringify(env)).toBe(raw);
}
const timelineIds = [
  REVIEWED_SB_HISTORY_MODEL.panels[0].tabId,
  REVIEWED_SB_NOTEBOOK_MODEL.panels[0].tabId,
];

describe('complete Source0.2.83 @13 pure models through real Host consumers, synthetic PARTIAL', () => {
  it.each(SB_TIMELINE_PATHS)(
    'accepts actual v2 document URL at reviewed path %s with raw unchanged',
    (path) => {
      const env = syntheticTimelineCapture(path),
        raw = JSON.stringify(env);
      expect(prepare(env).envelope).toEqual(env);
      expect(
        adapt(env).output.nativePackage.records[0].rawFields
          .completeOwnedSource,
      ).toEqual(sbProof(env));
      expect(JSON.stringify(env)).toBe(raw);
    },
  );
  it('normalizes only the validated projection, never the received document URL', () => {
    const a = syntheticTimelineCapture(SB_TIMELINE_PATHS[0]),
      b = syntheticTimelineCapture(SB_TIMELINE_PATHS[1]);
    expect(a.package.records[0].snapshotId).toBe(
      b.package.records[0].snapshotId,
    );
    expect(completeContentIdentityProjection(a.package.records[0])).toEqual(
      completeContentIdentityProjection(b.package.records[0]),
    );
    expect(prepare(a).payloadDigest).not.toBe(prepare(b).payloadDigest);
    expect(a.requestId).not.toBe(b.requestId);
  });
  it.each(timelineIds)(
    'requires fresh v2 actual document binding for %s (including complete about:blank)',
    (id) => {
      for (const change of [
        'missing-url',
        'blank-complete',
        'foreign-url',
        'different-path',
        'legacy-v1',
      ]) {
        const env = syntheticTimelineCapture(SB_TIMELINE_PATHS[0]);
        for (const read of sbProof(env).reads) {
          const evidence: any = timelineTab(read, id).purposeEvidence;
          if (change === 'legacy-v1') {
            evidence.schemaVersion = evidence.schemaVersion.replace(
              '.v2',
              '.v1',
            );
            evidence.modelRevision = evidence.modelRevision.replace('@2', '@1');
          }
          for (const frame of [evidence.before, evidence.after]) {
            const e = frame.embeddedReferences[0];
            if (change === 'missing-url' || change === 'legacy-v1')
              delete e.documentUrl;
            if (change === 'blank-complete') e.documentUrl = 'about:blank';
            if (change === 'foreign-url')
              e.documentUrl = e.rawSrc.replace(
                'tdms.airchina.com',
                'unreviewed.invalid',
              );
            if (change === 'different-path')
              e.documentUrl = e.rawSrc.replace(
                SB_TIMELINE_PATHS[0],
                SB_TIMELINE_PATHS[1],
              );
          }
        }
        rejectRaw(
          env,
          id === timelineIds[0]
            ? 'TDMS_COMPLETE_SB_HISTORY_PURPOSE_INVALID'
            : 'TDMS_COMPLETE_SB_NOTEBOOK_PURPOSE_INVALID',
        );
      }
    },
  );
  it.each(timelineIds)(
    'rejects raw URI drift within one capture before projection %s',
    (id) => {
      const env = syntheticTimelineCapture(SB_TIMELINE_PATHS[0]);
      const frame: any = timelineTab(sbProof(env).reads[1], id).purposeEvidence
        .after;
      frame.embeddedReferences[0].rawSrc =
        frame.embeddedReferences[0].rawSrc.replace(
          SB_TIMELINE_PATHS[0],
          SB_TIMELINE_PATHS[1],
        );
      frame.embeddedReferences[0].documentUrl =
        frame.embeddedReferences[0].rawSrc;
      rejectRaw(env);
    },
  );
  it.each([canonicalCaption, alternateCaption, documentCaption])(
    'accepts only reviewed BizNo caption %s with raw preserved',
    (label) => {
      const env = syntheticSbCaption(label),
        raw = JSON.stringify(env);
      expect(prepare(env).envelope).toEqual(env);
      expect(adapt(env).output.nativePackage.records[0].coverage.status).toBe(
        'PARTIAL',
      );
      expect(JSON.stringify(env)).toBe(raw);
      expect(env.package.records[0].snapshotId).toBe(
        syntheticSbCaption().package.records[0].snapshotId,
      );
    },
  );
  it('does not normalize same-capture caption drift, wrong token, unknown caption, or another column', () => {
    for (const change of ['drift', 'token', 'unknown', 'other-column']) {
      const env = syntheticSbCaption();
      for (const [index, read] of sbProof(env).reads.entries()) {
        const tree = captionTree(read);
        if (change === 'drift' && index === 1)
          setReadCaption(read, documentCaption);
        if (change === 'token')
          tree.nativeTreeEvidence.columns[5].nativeColumnToken = 'BizNo';
        if (change === 'unknown') setReadCaption(read, 'unreviewed caption');
        if (change === 'other-column') tree.rawHeaders[4] = documentCaption;
      }
      rejectRaw(env);
    }
  });
  it.each([
    [
      'business content',
      (e: any) => changeBusinessTitle(e, 'changed synthetic title'),
    ],
    ['technical version', changeTechnicalVersion],
    ['owner', changeNativeTarget],
  ] as const)(
    'keeps actual %s changes distinct despite display aliases',
    (_name, change) => {
      const first = syntheticSbCaption(),
        second = change(syntheticSbCaption(documentCaption));
      expect(prepare(second).envelope).toEqual(second);
      expect(first.package.records[0].snapshotId).not.toBe(
        second.package.records[0].snapshotId,
      );
    },
  );
  it('accepts exactly two unindexed Notebook leaves without synthesizing zero or business targets', () => {
    const env = syntheticNativeNotebook(),
      raw = JSON.stringify(env);
    const native = adapt(env).output.nativePackage;
    expect(prepare(env).envelope).toEqual(env);
    for (const read of sbProof(env).reads) {
      const table = notebookTable(read);
      expect(table.rows.map((r) => r.globalIndex)).toEqual([null, null]);
      expect(table.rows.flatMap((r) => r.sourceLinks)).toEqual([]);
      expect(table.terminal).toMatchObject({
        trueZero: false,
        allGlobalIndices: false,
        total: 2,
      });
    }
    expect(native.artifacts).toEqual([]);
    expect(native.records[0].relatedDocumentVersionIds).toEqual([]);
    expect(JSON.stringify(env)).toBe(raw);
  });
  it('normalizes only validated Notebook clock copies and reviewed ASCII mtime display spaces', () => {
    const first = syntheticNativeNotebook(),
      second = syntheticNativeNotebook(900);
    expect(first.package.records[0].snapshotId).toBe(
      second.package.records[0].snapshotId,
    );
    expect(first.requestId).not.toBe(second.requestId);
    treeMtime(second, (s) => s.replace(/ /gu, '  '));
    sealSb(second);
    const raw = JSON.stringify(second);
    expect(prepare(second).envelope).toEqual(second);
    // The reviewed mtime comparison accepts display spacing; its raw spelling
    // is retained in identity. Only Notebook's validated clock is normalized.
    expect(first.package.records[0].snapshotId).not.toBe(
      second.package.records[0].snapshotId,
    );
    expect(JSON.stringify(second)).toBe(raw);
  });
  it('retains full v2/Notebook raw proof through actual SourceService, immutable request readback and exact SourceRefs', async () => {
    const env = syntheticNativeNotebook(),
      raw = JSON.stringify(env);
    const repository = new MemoryTdmsRepository(),
      claims = adapt(env).memberClaims;
    const authority = new HostDecisionTdmsSourceAuthorization(
      async () => [
        { scope: nativeScope, permissionRevision: 'synthetic-source-83' },
      ],
      async ({ grant }) => ({
        ...grant,
        authorityRef: 'synthetic-import-83',
        captureRetentionAllowed: true,
        nativeProjectionAllowed: true,
        permittedMembers: claims,
      }),
      async ({ grant }) => ({
        ...grant,
        authorityRef: 'synthetic-read-83',
        retainedCaptureReadAllowed: true,
        permittedMembers: claims,
      }),
    );
    const artifacts = { acquire: jest.fn() },
      documents = { assertRead: jest.fn() };
    const service = new TdmsSourceService(
      repository,
      authority,
      artifacts,
      documents,
    );
    const receipt = await service.importDailyMetadata(actor(), env);
    expect(Object.keys(receipt)).toHaveLength(10);
    expect(receipt.documentVersionMappings).toEqual([]);
    expect(await service.importDailyMetadata(actor(), env)).toEqual(receipt);
    expect(
      (await service.readDailyMetadataImport(actor(), env.requestId)).package,
    ).toEqual(env.package);
    for (const ref of receipt.sourceRefs)
      expect(await service.readDailySourceRef(actor(), ref)).toBeDefined();
    expect(repository.state.captures).toHaveLength(1);
    expect(artifacts.acquire).not.toHaveBeenCalled();
    expect(documents.assertRead).not.toHaveBeenCalled();
    expect(JSON.stringify(env)).toBe(raw);
  });
  it.each([
    'foreign-outer',
    'foreign-hash',
    'credentials',
    'wrong-owner',
    'third-leaf',
    'invented-index',
    'business-link',
    'malformed-rows',
  ])(
    'rejects exact Notebook-only %s at actual API, without Structure masking it',
    (change) => {
      const env = syntheticNotebookOnly();
      for (const read of sbProof(env).reads) {
        const table: any = notebookTable(read);
        let url = read.domDocumentIdentity.url;
        if (change === 'foreign-outer')
          url = url.replace('tdms.airchina.com', 'unreviewed.invalid');
        if (change === 'foreign-hash')
          url = url.replace('#ptc1', '#ptc1https://unreviewed.invalid');
        if (change === 'credentials')
          url = url.replace('http://', 'http://user@');
        if (change === 'wrong-owner')
          url = url.replace(
            read.owner.sourceRecordId,
            read.owner.sourceRecordId + '0',
          );
        read.domDocumentIdentity.url = url;
        table.relatedSurfaceEvidence.normalBinding.url = url;
        if (change === 'third-leaf') table.rows.push(table.rows[0]);
        if (change === 'invented-index') table.rows[0].globalIndex = 0;
        if (change === 'business-link')
          table.rows[0].sourceLinks.push({
            targetRef: 'OR:wt.doc.WTDocument:999',
          });
        if (change === 'malformed-rows') table.relatedSurfaceEvidence.rows = {};
      }
      rejectRaw(env, 'TDMS_COMPLETE_SB_NOTEBOOK_NATIVE_ROWS_INVALID');
    },
  );
  it.each(['reads', 'tabs', 'relationTables'])(
    'retains typed 400 for malformed %s before projection mapping',
    (key) => {
      for (const value of [null, {}, [null]]) {
        const env = syntheticNativeNotebook();
        if (key === 'reads') sbProof(env).reads = value;
        else sbProof(env).reads[0][key] = value;
        rejectRaw(env, 'TDMS_COMPLETE_OWN_FIELDS_INVALID');
      }
    },
  );
});
