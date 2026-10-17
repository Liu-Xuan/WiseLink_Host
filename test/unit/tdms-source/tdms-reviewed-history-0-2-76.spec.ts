import { prepareTdmsDailySourceImport } from '../../../server/modules/tdms-source/tdms-daily-metadata-contract';
import { adaptTdmsDailySource } from '../../../server/modules/tdms-source/tdms-daily-source-adapter';
import { completeContentIdentityProjection } from '../../../server/modules/tdms-source/tdms-complete-owned-source.validation';
import { TdmsSourceService } from '../../../server/modules/tdms-source/tdms-source.service';
import { HostDecisionTdmsSourceAuthorization } from '../../../server/modules/tdms-source/tdms-source.authorization';
import { MemoryTdmsRepository, nativeScope } from './tdms-memory-double';
import { actor } from './tdms-fixtures';
import {
  REVIEWED_SB_HISTORY_MODEL,
  validateReviewedSbHistoryPurpose,
} from '../../../server/modules/tdms-source/tdms-reviewed-sb-history-purpose';
import {
  REVIEWED_SB_NOTEBOOK_MODEL,
  validateReviewedSbNotebookPurpose,
} from '../../../server/modules/tdms-source/tdms-reviewed-sb-notebook-purpose';
import { sbProof, sealSb } from './tdms-reviewed-sb-0-2-73.fixture';
import {
  SB_TIMELINE_PATHS,
  SB_TIMELINE_TAB_IDS,
  setTimelinePath,
  timelineTab,
  sealTimelineRawDigest,
  syntheticTimelineCapture,
} from './tdms-reviewed-history-0-2-76.fixture';

describe('Source 0.2.76 @9 timeline identity through Host consumers (synthetic PARTIAL)', () => {
  it.each(SB_TIMELINE_PATHS)(
    'accepts @9 native path %s through prepare and adapter without changing raw',
    (path) => {
      const env = syntheticTimelineCapture(path);
      const raw = JSON.stringify(env);
      const prepared = prepareTdmsDailySourceImport(env);
      const adapted = adaptTdmsDailySource(env);
      expect(prepared.envelope).toEqual(env);
      expect(
        adapted.output.nativePackage.records[0]!.rawFields.completeOwnedSource,
      ).toEqual(sbProof(env));
      expect(adapted.output.nativePackage.records[0]!.coverage.status).toBe(
        'PARTIAL',
      );
      expect(
        adapted.output.nativePackage.records[0]!.relatedDocumentVersionIds,
      ).toEqual([]);
      expect(adapted.output.nativePackage.artifacts).toEqual([]);
      expect(JSON.stringify(env)).toBe(raw);
    },
  );

  it('gives the two @9 paths one content snapshot identity while retaining distinct raw package digests', () => {
    const app = syntheticTimelineCapture(SB_TIMELINE_PATHS[0]);
    const native = syntheticTimelineCapture(SB_TIMELINE_PATHS[1]);
    expect(completeContentIdentityProjection(app.package.records[0])).toEqual(
      completeContentIdentityProjection(native.package.records[0]),
    );
    expect(app.package.records[0]!.snapshotId).toBe(
      native.package.records[0]!.snapshotId,
    );
    expect(prepareTdmsDailySourceImport(app).sourceRefs).toEqual(
      prepareTdmsDailySourceImport(native).sourceRefs,
    );
    expect(app.requestId).not.toBe(native.requestId);
    expect(prepareTdmsDailySourceImport(app).payloadDigest).not.toBe(
      prepareTdmsDailySourceImport(native).payloadDigest,
    );
  });

  it('retains both exact raw captures and stable retry through the actual SourceService', async () => {
    const app = syntheticTimelineCapture(SB_TIMELINE_PATHS[0]);
    const native = syntheticTimelineCapture(SB_TIMELINE_PATHS[1]);
    const claims = adaptTdmsDailySource(app).memberClaims;
    const repository = new MemoryTdmsRepository();
    const authority = new HostDecisionTdmsSourceAuthorization(
      async () => [
        { scope: nativeScope, permissionRevision: 'synthetic-timeline-1' },
      ],
      async ({ grant }) => ({
        ...grant,
        authorityRef: 'synthetic-import',
        captureRetentionAllowed: true,
        nativeProjectionAllowed: true,
        permittedMembers: claims,
      }),
      async ({ grant }) => ({
        ...grant,
        authorityRef: 'synthetic-read',
        retainedCaptureReadAllowed: true,
        permittedMembers: claims,
      }),
    );
    const artifacts = { acquire: jest.fn() };
    const documents = { assertRead: jest.fn() };
    const service = new TdmsSourceService(
      repository,
      authority,
      artifacts,
      documents,
    );
    const first = await service.importDailyMetadata(actor(), app);
    const second = await service.importDailyMetadata(actor(), native);
    expect(first.sourceRefs).toEqual(second.sourceRefs);
    for (const [env, receipt] of [
      [app, first],
      [native, second],
    ] as const) {
      expect(Object.keys(receipt)).toHaveLength(10);
      expect(await service.importDailyMetadata(actor(), env)).toEqual(receipt);
      expect(
        (await service.readDailyMetadataImport(actor(), env.requestId)).package,
      ).toEqual(env.package);
    }
    expect(repository.state.captures).toHaveLength(2);
    expect(artifacts.acquire).not.toHaveBeenCalled();
    expect(documents.assertRead).not.toHaveBeenCalled();
  });

  it.each(SB_TIMELINE_TAB_IDS)(
    'keeps a same-capture path switch visible to raw double-read validation (%s)',
    (tabId) => {
      const env = syntheticTimelineCapture(SB_TIMELINE_PATHS[0]);
      setTimelinePath(env, SB_TIMELINE_PATHS[1], 1, tabId);
      sealSb(env);
      expect(() => prepareTdmsDailySourceImport(env)).toThrow(
        'TDMS_COMPLETE_OWN_OBSERVATION_CHANGED',
      );
    },
  );

  it.each(['reads', 'read-entry', 'tabs', 'fields', 'relationTables'] as const)(
    'preserves typed malformed %s rejection before the timeline projection maps data',
    (key) => {
      for (const value of [null, {}, [null]]) {
        const env = syntheticTimelineCapture(SB_TIMELINE_PATHS[0]);
        const proof = sbProof(env);
        if (key === 'reads') proof.reads = value;
        else if (key === 'read-entry') proof.reads[0] = value;
        else proof.reads[0][key] = value;
        sealTimelineRawDigest(env);
        expect(() => prepareTdmsDailySourceImport(env)).toThrow(
          'TDMS_COMPLETE_OWN_',
        );
        try {
          prepareTdmsDailySourceImport(env);
          throw new Error('EXPECTED_TYPED_REJECTION');
        } catch (error) {
          expect(error).toMatchObject({
            code: expect.stringMatching(/^TDMS_COMPLETE_OWN_/u),
            statusCode: 400,
          });
        }
      }
    },
  );

  describe.each([
    {
      name: 'history',
      model: REVIEWED_SB_HISTORY_MODEL,
      validate: validateReviewedSbHistoryPurpose,
      code: 'TDMS_COMPLETE_SB_HISTORY_PURPOSE_INVALID',
    },
    {
      name: 'notebook',
      model: REVIEWED_SB_NOTEBOOK_MODEL,
      validate: validateReviewedSbNotebookPurpose,
      code: 'TDMS_COMPLETE_SB_NOTEBOOK_PURPOSE_INVALID',
    },
  ])(
    '$name purpose binds before pathname normalization',
    ({ model, validate, code }) => {
      it.each(SB_TIMELINE_PATHS)(
        'accepts only the reviewed final timeline at %s',
        (path) => {
          const env = syntheticTimelineCapture(path);
          for (const read of sbProof(env).reads) {
            const tab = timelineTab(read, model.panels[0].tabId);
            expect(
              validate(tab.purposeEvidence, {
                scopeId: 'SB',
                owner: read.owner,
                tab,
                read,
              }),
            ).toMatchObject({ complete: true });
          }
        },
      );

      it('accepts the exact optional native query parameters without changing raw strings', () => {
        const env = syntheticTimelineCapture(SB_TIMELINE_PATHS[1]);
        for (const read of sbProof(env).reads) {
          const tab = timelineTab(read, model.panels[0].tabId);
          for (const frame of [
            tab.purposeEvidence.before,
            tab.purposeEvidence.after,
          ])
            frame.embeddedReferences[0]!.rawSrc +=
              '&u8=1&AjaxEnabled=thirdLevelNav';
        }
        sealSb(env);
        const raw = JSON.stringify(env);
        expect(prepareTdmsDailySourceImport(env).envelope).toEqual(env);
        expect(JSON.stringify(env)).toBe(raw);
      });

      it.each([
        'unknown-path',
        'foreign-origin',
        'username',
        'password',
        'fragment',
        'wrong-owner',
        'owner-alias',
        'duplicate-oid',
        'unknown-query',
        'wrong-u8',
        'duplicate-u8',
        'wrong-AjaxEnabled',
        'duplicate-AjaxEnabled',
        'relative-url',
        'not-ready',
        'body-read',
        'iframe-id',
        'purpose-owner',
        'technical-revision',
        'technical-iteration',
        'modified',
        'state',
        'context',
        'unsettled',
        'before-after-path',
      ] as const)(
        'rejects %s through the actual prepare projection with the stable 400',
        (change) => {
          const env = syntheticTimelineCapture(SB_TIMELINE_PATHS[0]);
          for (const read of sbProof(env).reads) {
            const tab = timelineTab(read, model.panels[0].tabId);
            const evidence = tab.purposeEvidence;
            if (change === 'purpose-owner') evidence.ownerSourceRecordId += '0';
            if (change === 'technical-revision')
              evidence.sourceVersion.rawRevision = 'B';
            if (change === 'technical-iteration')
              evidence.sourceVersion.rawIteration = '2';
            if (change === 'modified') evidence.sourceModifiedRaw += '-changed';
            if (change === 'state') evidence.ownStateRaw = 'Approved';
            if (change === 'context')
              evidence.sourceContext.principalDisplayName += '-different';
            if (change === 'unsettled') evidence.settledReads = 1;
            for (const frame of [evidence.before, evidence.after]) {
              const embedded = frame.embeddedReferences[0]!;
              const url = new URL(embedded.rawSrc);
              if (change === 'unknown-path') url.pathname += '-unknown';
              if (change === 'foreign-origin')
                url.hostname = 'unreviewed.invalid';
              if (change === 'username') url.username = 'synthetic';
              if (change === 'password') url.password = 'synthetic';
              if (change === 'fragment') url.hash = 'unreviewed';
              if (change === 'wrong-owner')
                url.searchParams.set('oid', read.owner.sourceRecordId + '0');
              if (change === 'owner-alias')
                url.searchParams.set(
                  'oid',
                  read.owner.sourceRecordId.replace(/^OR:/u, 'VR:'),
                );
              if (change === 'duplicate-oid')
                url.searchParams.append('oid', read.owner.sourceRecordId);
              if (change === 'unknown-query')
                url.searchParams.set('unreviewed', '1');
              if (change === 'wrong-u8') url.searchParams.set('u8', '0');
              if (change === 'duplicate-u8') {
                url.searchParams.append('u8', '1');
                url.searchParams.append('u8', '1');
              }
              if (change === 'wrong-AjaxEnabled')
                url.searchParams.set('AjaxEnabled', 'true');
              if (change === 'duplicate-AjaxEnabled') {
                url.searchParams.append('AjaxEnabled', 'thirdLevelNav');
                url.searchParams.append('AjaxEnabled', 'thirdLevelNav');
              }
              embedded.rawSrc = url.href;
              if (change === 'relative-url')
                embedded.rawSrc = url.pathname + url.search;
              if (change === 'not-ready') embedded.readyState = 'interactive';
              if (change === 'body-read') embedded.bodyState = 'VALUE';
              if (change === 'iframe-id') embedded.id += '-unknown';
            }
            if (change === 'before-after-path') {
              evidence.after.embeddedReferences[0]!.rawSrc =
                'http://tdms.airchina.com' +
                SB_TIMELINE_PATHS[1] +
                '?oid=' +
                read.owner.sourceRecordId;
            }
          }
          sealTimelineRawDigest(env);
          const raw = JSON.stringify(env);
          expect(() => prepareTdmsDailySourceImport(env)).toThrow(code);
          expect(() => adaptTdmsDailySource(env)).toThrow(code);
          try {
            prepareTdmsDailySourceImport(env);
            throw new Error('EXPECTED_PURPOSE_REJECTION');
          } catch (error) {
            expect(error).toMatchObject({ code, statusCode: 400 });
          }
          expect(JSON.stringify(env)).toBe(raw);
        },
      );
    },
  );
});
