import { TdmsSourceService } from '../../../server/modules/tdms-source/tdms-source.service';
import {
  HostDecisionTdmsSourceAuthorization,
  UnconfiguredTdmsSourceAuthorization,
} from '../../../server/modules/tdms-source/tdms-source.authorization';
import { adaptTdmsDailySource } from '../../../server/modules/tdms-source/tdms-daily-source-adapter';
import {
  hash,
  sourcePackage,
} from '../../../server/modules/tdms-source/tdms-source.validation';
import {
  prepareTdmsDailyMetadataImport,
  prepareTdmsDailySourceImport,
} from '../../../server/modules/tdms-source/tdms-daily-metadata-contract';
import {
  COMPLETE_OWN_PACKAGE_MAX_BYTES,
  COMPLETE_OWN_REQUEST_MAX_BYTES,
} from '../../../server/modules/tdms-source/tdms-complete-owned-source.validation';
import { MemoryTdmsRepository, nativeScope } from './tdms-memory-double';
import { actor } from './tdms-fixtures';
import {
  copyComplete,
  completeComparison,
  sealComplete,
  syntheticCompleteEnvelope,
  withCompleteRelation,
  type CompleteScope,
} from './tdms-complete-owned.fixture';

function setup(env = syntheticCompleteEnvelope()) {
  const claims = copyComplete(adaptTdmsDailySource(env).memberClaims),
    repository = new MemoryTdmsRepository();
  const state = { canImport: true, canRead: true, revision: 'synthetic-1' };
  // Independent synthetic decisions for these exact members only. Never registered in AppModule.
  const authority = new HostDecisionTdmsSourceAuthorization(
    async () => [{ scope: nativeScope, permissionRevision: state.revision }],
    async ({ grant }) => ({
      ...grant,
      authorityRef: 'synthetic-import',
      captureRetentionAllowed: true,
      nativeProjectionAllowed: true,
      permittedMembers: state.canImport
        ? claims
        : { records: [], relationIds: [], artifacts: [] },
    }),
    async ({ grant }) => ({
      ...grant,
      authorityRef: 'synthetic-read',
      retainedCaptureReadAllowed: true,
      permittedMembers: state.canRead
        ? claims
        : { records: [], relationIds: [], artifacts: [] },
    }),
  );
  const artifacts = { acquire: jest.fn() },
    documents = { assertRead: jest.fn() };
  return {
    repository,
    state,
    claims,
    artifacts,
    documents,
    service: new TdmsSourceService(repository, authority, artifacts, documents),
  };
}
const proofOf = (env: ReturnType<typeof syntheticCompleteEnvelope>) =>
  env.package.records[0].rawFields.completeOwnedSource as ReturnType<
    typeof syntheticCompleteEnvelope
  >['package']['records'][number]['rawFields'] & {
    reads: Array<{ [key: string]: any }>;
  };

function sealRelationEnvelope(
  env: ReturnType<typeof syntheticCompleteEnvelope>,
) {
  sealComplete(env);
  for (const edge of env.package.edges) {
    edge.fromSnapshotId = env.package.records[0].snapshotId;
    const { edgeId: ignored, ...identity } = edge;
    void ignored;
    edge.edgeId = 'TDMSEDGE-' + hash(completeComparison(identity));
  }
  env.requestId = 'TDMSIMPORT-' + hash(env.package);
  return env;
}

function withReusedStatus() {
  const env = withCompleteRelation(syntheticCompleteEnvelope('EO')),
    r = env.package.records[0],
    proof = proofOf(env),
    target = 'OR:com.airchina.tdms.statuslink.TDMSStatusLink:999';
  for (const read of proof.reads) {
    const table = read.relationTables[0],
      link = table.rows[0].sourceLinks[0];
    table.gridId = 'relatedStatusLinkTable';
    Object.assign(link, {
      targetRef: target,
      rawHref: '/infoPage?oid=' + target,
      nativeRole: 'STATUS_LINK',
      nativeColumnToken: 'number',
    });
    table.nativeStatusProof = {
      schemaVersion: 'wiselink.tdms-reused-status-enumeration.v1',
      ownerSourceRecordId: r.sourceRecordId,
      ownerSourceVersion: copyComplete(r.sourceVersion),
      engineeringDocumentNumber: r.number,
      statusTable: {
        ownerSourceRecordId: r.sourceRecordId,
        reportedCount: 1,
        rows: [
          {
            sourceRecordId: target,
            number: 'Synthetic target',
            stateRaw: 'Feedback pending',
            sourceModifiedRaw: '2026-10-12 09:00',
            executionStatus: {
              engineeringDocumentRef: r.sourceRecordId,
              engineeringDocumentNumber: r.number,
              assetRef: 'OR:wt.part.WTPart:701',
              assetNumber: 'SYNTHETIC-AIRCRAFT',
              feedbackRef: 'OR:wt.doc.WTDocument:702',
              feedbackNumber: 'SYNTHETIC-FEEDBACK',
              executedDateRaw: 'TBD',
              stateComments: 'Feedback received 2026-10-12; planned 2026-11-01',
              expiredDateRaw: '2027-01-01',
              operatorBase: 'Synthetic base',
            },
          },
        ],
        observedAt: r.observedAt,
        complete: true,
      },
    };
  }
  Object.assign(
    (proof.targetOccurrences as Array<Record<string, unknown>>)[0],
    {
      targetRef: target,
      rawHref: '/infoPage?oid=' + target,
      nativeLinkRole: 'STATUS_LINK',
      nativeColumnToken: 'number',
      modelRoleOrigin: 'REVIEWED_NATIVE_COLUMN_MODEL',
    },
  );
  env.package.edges[0].toSourceRecordId = target;
  return sealRelationEnvelope(env);
}

describe('Complete1 through the existing Daily/native transaction and exact readback (synthetic only)', () => {
  it.each<CompleteScope>([
    'SB_PROCESSING_FORM',
    'SB_ASSESSMENT_FORM',
    'AD_PROCESSING_FORM',
    'ENGINEERING_ASSESSMENT',
    'EO',
    'AIRCRAFT_STATUS',
    'AIRCRAFT_FEEDBACK',
    'AD_ITEM',
  ])(
    'retains %s own DTO, original hashes, eight states and exact history without authority promotion',
    async (scope) => {
      const env = syntheticCompleteEnvelope(scope),
        before = JSON.stringify(env),
        s = setup(env);
      const receipt = await s.service.importDailyMetadata(actor(), env);
      expect(Object.keys(receipt)).toHaveLength(10);
      expect(receipt).toMatchObject({
        payloadDigest: hash(env.package),
        objectCount: 1,
        artifactCount: 0,
        relationCount: 0,
      });
      expect(JSON.stringify(env)).toBe(before);
      expect(
        (await s.service.readDailyMetadataImport(actor(), env.requestId))
          .package,
      ).toEqual(env.package);
      const ref = 'TDMS:SNAPSHOT:' + env.package.records[0].snapshotId;
      expect(
        (await s.service.readDailySourceRef(actor(), ref)).snapshot,
      ).toEqual(env.package.records[0]);
      const native = s.repository.state.revisions[0].record;
      expect(native.content.completeOwnedFields).toEqual(
        env.package.records[0].content.completeOwnedFields,
      );
      expect(
        new Set(native.content.completeOwnedFields?.map((f) => f.value.state))
          .size,
      ).toBe(8);
      expect(native.content).not.toHaveProperty('opinions');
      expect(native.recordKind).toBe(
        ['AIRCRAFT_STATUS', 'AIRCRAFT_FEEDBACK', 'AD_ITEM'].includes(scope)
          ? 'OBSERVATION'
          : env.package.records[0].kind,
      );
      expect(s.repository.state.captures[0].receipt.executionVerified).toBe(
        false,
      );
      expect(native.coverage.status).toBe('PARTIAL');
      expect(s.artifacts.acquire).not.toHaveBeenCalled();
      expect(
        await s.service.importDailyMetadata(actor(), copyComplete(env)),
      ).toEqual(receipt);
      expect(s.repository.state.revisions).toHaveLength(1);
    },
  );
  it('keeps two same-business-version assessments independent', async () => {
    const first = syntheticCompleteEnvelope('SB_ASSESSMENT_FORM', 901),
      second = syntheticCompleteEnvelope('SB_ASSESSMENT_FORM', 902);
    for (const [index, env] of [first, second].entries()) {
      const proof = proofOf(env);
      for (const read of proof.reads)
        Object.assign(read.fields[0].value, {
          actualLabel: '评估意见:',
          rawValue: 'Independent opinion ' + index,
          observedTotalCodepoints: 21,
        });
      env.package.records[0].content.completeOwnedFields = copyComplete(
        proof.reads[1].fields,
      );
      sealComplete(env);
    }
    const s = setup(first);
    s.claims.records.push(...adaptTdmsDailySource(second).memberClaims.records);
    const a = await s.service.importDailyMetadata(actor(), first),
      b = await s.service.importDailyMetadata(actor(), second);
    expect(a.requestId).not.toBe(b.requestId);
    expect(s.repository.state.revisions).toHaveLength(2);
    expect(
      s.repository.state.revisions.map((r) => r.record.businessVersion),
    ).toEqual([
      first.package.records[0].businessVersion,
      second.package.records[0].businessVersion,
    ]);
    expect(
      s.repository.state.revisions.map(
        (r) => r.record.content.completeOwnedFields![0].value.rawValue,
      ),
    ).toEqual(['Independent opinion 0', 'Independent opinion 1']);
    expect(
      s.repository.state.revisions.every(
        (r) => r.record.content.opinions === undefined,
      ),
    ).toBe(true);
  });
  it('source/default and current member denials leave no new capture, later read revocation hides the body', async () => {
    const env = syntheticCompleteEnvelope(),
      s = setup(env);
    await expect(
      new TdmsSourceService(
        s.repository,
        new UnconfiguredTdmsSourceAuthorization(),
        s.artifacts,
        s.documents,
      ).importDailyMetadata(actor(), env),
    ).rejects.toMatchObject({ code: 'TDMS_SOURCE_AUTHORIZATION_UNCONFIGURED' });
    s.state.canImport = false;
    await expect(
      s.service.importDailyMetadata(actor(), env),
    ).rejects.toMatchObject({
      code: 'TDMS_IMPORT_MEMBER_SCOPE_ADMISSION_REQUIRED',
    });
    expect(s.repository.state.captures).toHaveLength(0);
    s.state.canImport = true;
    await s.service.importDailyMetadata(actor(), env);
    s.state.canRead = false;
    await expect(
      s.service.readDailyMetadataImport(actor(), env.requestId),
    ).rejects.toMatchObject({
      code: 'TDMS_READ_MEMBER_SCOPE_ADMISSION_REQUIRED',
    });
  });
  it.each([
    'schema',
    'mode',
    'extra-proof',
    'owner',
    'version',
    'read-order',
    'double-read',
    'field-order',
    'typed-blank',
    'typed-absent',
    'roster',
    'content',
    'occurrences',
    'provenance',
    'coverage',
    'scope-complete',
    'legacy-mix',
  ])('rejects changed %s before native storage', (change) => {
    const env = syntheticCompleteEnvelope(),
      r = env.package.records[0],
      p = proofOf(env);
    switch (change) {
      case 'schema':
        p.schemaVersion = 'wrong';
        break;
      case 'mode':
        p.mode = 'wrong';
        break;
      case 'extra-proof':
        p.extra = true;
        break;
      case 'owner':
        p.reads[1].owner.sourceRecordId = 'OR:wt.change2.WTChangeRequest2:999';
        break;
      case 'version':
        p.reads[1].owner.sourceVersion = {
          rawRevision: 'A',
          rawIteration: '1',
          confirmation: 'SOURCE_DECLARED',
        };
        break;
      case 'read-order':
        p.reads[0].observedAt = '2026-10-13T01:00:00.000Z';
        break;
      case 'double-read':
        p.reads.pop();
        break;
      case 'field-order':
        p.reads[1].fields.reverse();
        break;
      case 'typed-blank':
        p.reads[1].fields[1].value.rawValue = ' ';
        break;
      case 'typed-absent':
        p.reads[1].fields[2].value.rawValue = '';
        break;
      case 'roster':
        p.reads[1].rosterEvidence.structuralRosters[0].after
          .declaredFieldCount++;
        break;
      case 'content':
        r.content.completeOwnedFields![0].value.rawValue = 'changed';
        break;
      case 'occurrences':
        (p.targetOccurrences as unknown[]).push({
          targetRef: 'OR:wt.doc.WTDocument:999',
        });
        break;
      case 'provenance':
        r.provenance[0].selector = 'invented';
        break;
      case 'coverage':
        r.coverage.status = 'COMPLETE';
        env.package.coverage.status = 'COMPLETE';
        break;
      case 'scope-complete':
        env.package.query.scopeComplete = true;
        break;
      case 'legacy-mix':
        r.content.boundedOwnedBody = [];
        break;
    }
    sealComplete(env);
    expect(() => adaptTdmsDailySource(env)).toThrow();
  });
  it('rechecks the effective native guard and refuses Estimating opinion text', () => {
    const env = syntheticCompleteEnvelope('SB_ASSESSMENT_FORM'),
      p = proofOf(env);
    for (const read of p.reads) {
      read.owner.stateRaw = 'Estimating';
      read.fields[0].value.actualLabel = '评估意见:';
    }
    env.package.records[0].state.rawName = 'Estimating';
    env.package.records[0].content.completeOwnedFields = copyComplete(
      p.reads[1].fields,
    );
    sealComplete(env);
    expect(() => adaptTdmsDailySource(env)).toThrow();
    const native = copyComplete(
      adaptTdmsDailySource(syntheticCompleteEnvelope()).output.nativePackage,
    );
    native.records[0].content.completeOwnedFields![0].value.rawValue =
      'unbound';
    expect(() => sourcePackage(native)).toThrow();
  });
  it('fails a whole over-limit body without trimming the raw field or changing the request', async () => {
    const env = syntheticCompleteEnvelope(),
      p = proofOf(env);
    for (const read of p.reads)
      for (const f of read.fields) {
        f.value.state = 'VALUE';
        f.value.rawValue = 'x'.repeat(90000);
        f.value.observedTotalCodepoints = 90000;
      }
    env.package.records[0].content.completeOwnedFields = copyComplete(
      p.reads[1].fields,
    );
    sealComplete(env);
    const before = JSON.stringify(env),
      s = setup();
    await expect(
      s.service.importDailyMetadata(actor(), env),
    ).rejects.toMatchObject({ code: 'TDMS_DAILY_LIMIT' });
    expect(JSON.stringify(env)).toBe(before);
    expect(s.repository.state.captures).toHaveLength(0);
  });
  it('legacy metadata preparation stays closed to new content', () =>
    expect(() =>
      prepareTdmsDailyMetadataImport(syntheticCompleteEnvelope()),
    ).toThrow());
  it('retains complete raw relation evidence as unresolved, preserving exact owner/target versions and original windows', async () => {
    const env = withCompleteRelation(),
      s = setup(env),
      before = JSON.stringify(env);
    const receipt = await s.service.importDailyMetadata(actor(), env);
    expect(receipt.relationCount).toBe(1);
    expect(JSON.stringify(env)).toBe(before);
    const assertion = s.repository.state.assertions[0].assertion;
    expect(assertion.authority).toBe('CANDIDATE_ONLY');
    expect(assertion.controlledKind).toBeNull();
    expect(assertion.to).toMatchObject({
      kind: 'UNRESOLVED',
      rawIdentity: env.package.edges[0].toSourceRecordId,
    });
    expect(
      (
        await s.service.readDailySourceRef(
          actor(),
          'TDMS:RELATION:' + env.package.edges[0].edgeId,
        )
      ).relation,
    ).toEqual(env.package.edges[0]);
    const later = copyComplete(env),
      proof = proofOf(later);
    proof.reads[1].relationTables[0].windows[0].observedAt =
      '2026-10-13T00:00:00.001Z';
    sealComplete(later);
    expect(later.package.records[0].snapshotId).toBe(
      env.package.records[0].snapshotId,
    );
    expect(later.requestId).not.toBe(env.requestId);
    expect(adaptTdmsDailySource(later).envelope).toEqual(later);
  });
  it.each([
    'target',
    'owner-version',
    'raw-direction',
    'count',
    'terminal',
    'window',
    'edge',
    'semantic-promotion',
  ])(
    'refuses unbound relation %s in either Daily or effective native ingress',
    (change) => {
      const env = withCompleteRelation(),
        proof = proofOf(env);
      for (const read of proof.reads) {
        const table = read.relationTables[0];
        if (change === 'target')
          table.rows[0].sourceLinks[0].targetRef = 'OR:wt.doc.WTDocument:998';
        if (change === 'owner-version')
          table.ownerSourceVersion = {
            rawRevision: 'A',
            rawIteration: '1',
            confirmation: 'SOURCE_DECLARED',
          };
        if (change === 'raw-direction') table.rows[0].rawDirection = 'changed';
        if (change === 'count') table.reportedTotal = 2;
        if (change === 'terminal') table.terminal.nativeTerminal = false;
        if (change === 'window') table.windows[0].rowOccurrenceIds = [];
      }
      if (change === 'edge')
        env.package.edges[0].toSourceRecordId = 'OR:wt.doc.WTDocument:998';
      sealRelationEnvelope(env);
      if (change === 'semantic-promotion') {
        const native = copyComplete(
          adaptTdmsDailySource(env).output.nativePackage,
        );
        native.relations[0].authority = 'SOURCE_EXPLICIT';
        expect(() => sourcePackage(native)).toThrow();
      } else expect(() => adaptTdmsDailySource(env)).toThrow();
    },
  );
  it.each([310, 700])(
    'retains Complete1 edge locators of %s characters and 500-character kinds through native projection',
    (locatorLength) => {
      const env = withCompleteRelation(),
        proof = proofOf(env),
        locator = '#' + 'x'.repeat(locatorLength - 1),
        kind = 'K'.repeat(500);
      for (const read of proof.reads) {
        read.relationTables[0].tableId = kind;
        read.relationTables[0].rows[0].sourceLinks[0].locator = locator;
      }
      Object.assign(
        (proof.targetOccurrences as Array<Record<string, unknown>>)[0],
        { locator, tableId: kind },
      );
      env.package.edges[0].evidenceLocator = locator;
      env.package.edges[0].relationKind = kind;
      sealRelationEnvelope(env);
      const adapted = adaptTdmsDailySource(env);
      expect(adapted.envelope).toEqual(env);
      expect(adapted.output.nativePackage.relations[0]).toMatchObject({
        rawKind: kind,
        selector: locator,
        authority: 'CANDIDATE_ONLY',
      });
      expect(sourcePackage(adapted.output.nativePackage)).toEqual(
        adapted.output.nativePackage,
      );
    },
  );
  it.each(['locator', 'kind'])(
    'rejects a Complete1 over-limit %s as a whole',
    (dimension) => {
      const env = withCompleteRelation(),
        proof = proofOf(env);
      if (dimension === 'locator') {
        const locator = '#' + 'x'.repeat(700);
        for (const read of proof.reads)
          read.relationTables[0].rows[0].sourceLinks[0].locator = locator;
        (proof.targetOccurrences as Array<Record<string, unknown>>)[0].locator =
          locator;
        env.package.edges[0].evidenceLocator = locator;
      } else {
        const kind = 'K'.repeat(501);
        for (const read of proof.reads) read.relationTables[0].tableId = kind;
        (proof.targetOccurrences as Array<Record<string, unknown>>)[0].tableId =
          kind;
        env.package.edges[0].relationKind = kind;
      }
      sealRelationEnvelope(env);
      const before = JSON.stringify(env);
      expect(() => adaptTdmsDailySource(env)).toThrow();
      expect(JSON.stringify(env)).toBe(before);
    },
  );
  it('retains a Complete1 observation beyond 512 KiB losslessly through import and exact readback while legacy metadata remains bounded', async () => {
    const env = syntheticCompleteEnvelope(),
      proof = proofOf(env),
      literal = '界'.repeat(90000);
    for (const read of proof.reads)
      Object.assign(read.fields[0].value, {
        rawValue: literal,
        observedTotalCodepoints: 90000,
      });
    env.package.records[0].content.completeOwnedFields = copyComplete(
      proof.reads[1].fields,
    );
    sealComplete(env);
    expect(Buffer.byteLength(JSON.stringify(proof))).toBeGreaterThan(
      512 * 1024,
    );
    expect(Buffer.byteLength(JSON.stringify(proof))).toBeLessThan(850 * 1024);
    expect(() => prepareTdmsDailyMetadataImport(env)).toThrow();
    const s = setup(env);
    await s.service.importDailyMetadata(actor(), env);
    expect(
      (await s.service.readDailyMetadataImport(actor(), env.requestId)).package,
    ).toEqual(env.package);
    expect(
      s.repository.state.revisions[0].record.content.completeOwnedFields![0]
        .value.rawValue,
    ).toBe(literal);
    const forged = copyComplete(adaptTdmsDailySource(env).output.nativePackage);
    (forged.records[0].rawFields.completeOwnedSource as any).mode = 'ORDINARY';
    expect(() => sourcePackage(forged)).toThrow();
  });
  it('rejects an observation above 850 KiB before retention even when its whole package is below 2 MiB', () => {
    const env = syntheticCompleteEnvelope(),
      proof = proofOf(env);
    for (const read of proof.reads) {
      Object.assign(read.fields[0].value, {
        rawValue: '界'.repeat(100000),
        observedTotalCodepoints: 100000,
      });
      Object.assign(read.fields[1].value, {
        state: 'VALUE',
        rawValue: '界'.repeat(60000),
        observedTotalCodepoints: 60000,
      });
    }
    env.package.records[0].content.completeOwnedFields = copyComplete(
      proof.reads[1].fields,
    );
    sealComplete(env);
    expect(Buffer.byteLength(JSON.stringify(proof))).toBeGreaterThan(
      850 * 1024,
    );
    expect(Buffer.byteLength(JSON.stringify(env))).toBeLessThan(
      2 * 1024 * 1024,
    );
    const before = JSON.stringify(env);
    expect(() => adaptTdmsDailySource(env)).toThrow('TDMS_COMPLETE_OWN_LIMIT');
    expect(JSON.stringify(env)).toBe(before);
  });
  it('rejects whole Daily and native packages above 2 MiB without clipping fields', () => {
    const env = syntheticCompleteEnvelope(),
      native = copyComplete(adaptTdmsDailySource(env).output.nativePackage);
    const oversized = Array.from({ length: 25 }, () => ({
      sourceRecordId: null,
      code: 'FAILED',
      detail: 'x'.repeat(90000),
    }));
    env.package.readFailures = oversized;
    native.readFailures = oversized;
    expect(Buffer.byteLength(JSON.stringify(env))).toBeGreaterThan(
      2 * 1024 * 1024,
    );
    const before = JSON.stringify(env);
    expect(() => adaptTdmsDailySource(env)).toThrow();
    expect(() => sourcePackage(native)).toThrow('TDMS_SMALL_PACKAGE_LIMIT');
    expect(JSON.stringify(env)).toBe(before);
  });
  it('does not spend the core package budget on the request wrapper or admit an oversized core', () => {
    const env = syntheticCompleteEnvelope();
    env.package.readFailures = Array.from({ length: 25 }, () => ({
      sourceRecordId: null,
      code: 'FAILED',
      detail: 'x'.repeat(80000),
    }));
    let remaining =
      COMPLETE_OWN_PACKAGE_MAX_BYTES +
      1 -
      Buffer.byteLength(JSON.stringify(env.package));
    expect(remaining).toBeGreaterThan(0);
    for (const failure of env.package.readFailures) {
      const addition = Math.min(remaining, 100000 - failure.detail.length);
      failure.detail += 'x'.repeat(addition);
      remaining -= addition;
    }
    expect(remaining).toBe(0);
    sealComplete(env);
    expect(Buffer.byteLength(JSON.stringify(env.package))).toBe(
      COMPLETE_OWN_PACKAGE_MAX_BYTES + 1,
    );
    expect(Buffer.byteLength(JSON.stringify(env))).toBeLessThan(
      COMPLETE_OWN_REQUEST_MAX_BYTES,
    );
    const before = JSON.stringify(env);
    expect(() => prepareTdmsDailySourceImport(env)).toThrow('TDMS_DAILY_LIMIT');
    expect(JSON.stringify(env)).toBe(before);
  });
  it('keeps malformed native records as a structured input rejection before complete-mode proof validation', () => {
    const native = copyComplete(
      adaptTdmsDailySource(syntheticCompleteEnvelope()).output.nativePackage,
    );
    native.records = [null] as unknown as typeof native.records;
    expect(() => sourcePackage(native)).toThrow('TDMS_INPUT_INVALID');
  });
  it('retains Estimating state-only opinion presence as null without approving it', async () => {
    const env = syntheticCompleteEnvelope('SB_ASSESSMENT_FORM'),
      proof = proofOf(env);
    for (const read of proof.reads) {
      read.owner.stateRaw = 'Estimating';
      Object.assign(read.fields[0].value, {
        state: 'NOT_APPLICABLE',
        actualLabel: '评估意见:',
        rawValue: null,
        observedTotalCodepoints: 0,
      });
    }
    env.package.records[0].state.rawName = 'Estimating';
    env.package.records[0].content.completeOwnedFields = copyComplete(
      proof.reads[1].fields,
    );
    sealComplete(env);
    const s = setup(env);
    await s.service.importDailyMetadata(actor(), env);
    expect(
      s.repository.state.revisions[0].record.content.opinions,
    ).toBeUndefined();
    expect(
      s.repository.state.revisions[0].record.content.completeOwnedFields![0]
        .value,
    ).toMatchObject({ state: 'NOT_APPLICABLE', rawValue: null });
  });
  it('retains multiple owner/version-bound attachment identities and repeated role links as metadata', async () => {
    const env = syntheticCompleteEnvelope('EO'),
      proof = proofOf(env),
      r = env.package.records[0];
    const attachments = ['original-1', 'original-2', 'original-1'].map(
      (id, index) => ({
        ownerSourceRecordId: r.sourceRecordId,
        sourceVersion: copyComplete(r.sourceVersion),
        sourceAttachmentId: id,
        role: index === 2 ? 'SECONDARY' : 'ORIGINAL_REFERENCE',
        filename: 'same-name.pdf',
        rawHref: '/source-attachment/' + id,
        locator: '#attachment-' + index,
        state: 'VALUE',
      }),
    );
    for (const read of proof.reads)
      read.attachments = copyComplete(attachments);
    sealComplete(env);
    const s = setup(env);
    await s.service.importDailyMetadata(actor(), env);
    const original = await s.service.readDailyMetadataImport(
      actor(),
      env.requestId,
    );
    expect(
      (original.package.records[0].rawFields.completeOwnedSource as any)
        .reads[1].attachments,
    ).toEqual(attachments);
    expect(
      adaptTdmsDailySource(env).output.nativePackage.records[0]
        .artifactMemberIds,
    ).toEqual([]);
    expect(s.artifacts.acquire).not.toHaveBeenCalled();
    const changed = copyComplete(env);
    for (const read of proofOf(changed).reads)
      read.attachments[0].sourceVersion.rawRevision = 'B';
    sealComplete(changed);
    expect(() => adaptTdmsDailySource(changed)).toThrow(
      'TDMS_COMPLETE_OWN_ATTACHMENT_BINDING_INVALID',
    );
  });
  it('retains duplicate raw target occurrences while deduplicating only the exact observed edge identity', async () => {
    const env = withCompleteRelation(),
      proof = proofOf(env);
    for (const read of proof.reads)
      read.relationTables[0].rows[0].sourceLinks.push(
        copyComplete(read.relationTables[0].rows[0].sourceLinks[0]),
      );
    const occurrences = proof.targetOccurrences as Array<
      Record<string, unknown>
    >;
    occurrences.push({ ...copyComplete(occurrences[0]), linkIndex: 1 });
    sealRelationEnvelope(env);
    const s = setup(env),
      receipt = await s.service.importDailyMetadata(actor(), env);
    expect(receipt.relationCount).toBe(1);
    expect(s.repository.state.assertions).toHaveLength(1);
    expect(
      (await s.service.readDailyMetadataImport(actor(), env.requestId)).package,
    ).toEqual(env.package);
    expect(occurrences).toHaveLength(2);
  });
  it('retains engineering required-target classification and unknown parent version without pretending complete coverage', async () => {
    const env = syntheticCompleteEnvelope('EO'),
      proof = proofOf(env),
      parent = copyComplete(
        (proofOf(syntheticCompleteEnvelope('AD_ITEM')).requestedCriteria as any)
          .sourceProof,
      );
    parent.targetRef = env.package.records[0].sourceRecordId;
    parent.classificationOperationId =
      'TDMSOP-22222222-2222-2222-2222-222222222222';
    parent.parentSourceVersion = {
      rawRevision: null,
      rawIteration: null,
      confirmation: 'VERSION_UNCONFIRMED',
    };
    (proof.requestedCriteria as any).sourceProof = parent;
    for (const read of proof.reads)
      read.owner.scopeEvidence.nativeTypeOrigin = 'REQUIRED_RELATION_TARGET';
    sealComplete(env);
    const s = setup(env);
    await s.service.importDailyMetadata(actor(), env);
    expect(
      (await s.service.readDailyMetadataImport(actor(), env.requestId)).package,
    ).toEqual(env.package);
    expect(env.package.coverage.status).toBe('PARTIAL');
    const changed = copyComplete(env);
    delete (proofOf(changed).requestedCriteria as any).sourceProof
      .classificationOperationId;
    sealComplete(changed);
    expect(() => adaptTdmsDailySource(changed)).toThrow(
      'TDMS_COMPLETE_OWN_FIELDS_INVALID',
    );
  });
  it('keeps changing capture/context evidence in each original request while using the current comparison-only content identity', async () => {
    const first = syntheticCompleteEnvelope('EO'),
      later = copyComplete(first),
      proof = proofOf(later);
    proof.documentIdentity = 'synthetic-later-document-identity';
    (proof.nativeReloadProvenance as any).documentIdentity =
      proof.documentIdentity;
    (proof.requestedCriteria as any).sourceProof.operationId =
      'TDMSOP-33333333-3333-3333-3333-333333333333';
    (proof.requestedCriteria as any).expectedOwner.sourceModifiedRaw = null;
    for (const read of proof.reads) {
      read.sourceContext.principalDisplayName = 'Synthetic later principal';
      read.sourceContext.principalId = 'synthetic-later-principal';
      read.sourceContext.principalLocator = '#later-native-account';
    }
    sealComplete(later);
    expect(later.package.records[0].snapshotId).toBe(
      first.package.records[0].snapshotId,
    );
    expect(later.requestId).not.toBe(first.requestId);
    const s = setup(first);
    await s.service.importDailyMetadata(actor(), first);
    await s.service.importDailyMetadata(actor(), later);
    expect(
      (await s.service.readDailyMetadataImport(actor(), first.requestId))
        .package,
    ).toEqual(first.package);
    expect(
      (await s.service.readDailyMetadataImport(actor(), later.requestId))
        .package,
    ).toEqual(later.package);
    // Existing immutable SourceRef semantics refuse two matching captures; no latest selection is added.
    await expect(
      s.service.readDailySourceRef(
        actor(),
        'TDMS:SNAPSHOT:' + first.package.records[0].snapshotId,
      ),
    ).rejects.toMatchObject({
      code: 'TDMS_DAILY_REFERENCE_AMBIGUOUS',
      statusCode: 409,
    });
  });
  it('normalizes only reviewed generated capture locators and keeps unknown identifiers and raw values in content identity', () => {
    const render = (prefix: string, id: number) => {
      const env = syntheticCompleteEnvelope('EO');
      const keys = new Set([
        'fieldId',
        'sectionId',
        'tabId',
        'panelLocator',
        'locator',
        'fieldIds',
        'sectionIds',
        'tabIds',
        'fieldLocators',
        'sectionLocators',
      ]);
      const decorate = (v: any, key = ''): any =>
        Array.isArray(v)
          ? v.map((x) => decorate(x, key))
          : v && typeof v === 'object'
            ? Object.fromEntries(
                Object.entries(v).map(([k, x]) => [k, decorate(x, k)]),
              )
            : typeof v === 'string' && keys.has(key)
              ? prefix + id + '/' + v
              : v;
      for (const read of proofOf(env).reads)
        for (const part of ['tabs', 'sections', 'fields', 'rosterEvidence'])
          read[part] = decorate(read[part]);
      env.package.records[0].content.completeOwnedFields = decorate(
        env.package.records[0].content.completeOwnedFields,
      );
      return sealComplete(env);
    };
    const first = render('infoPage_myTab_tab_jcaGen_', 100),
      second = render('infoPage_myTab_tab_jcaGen_', 200);
    expect(first.package.records[0].snapshotId).toBe(
      second.package.records[0].snapshotId,
    );
    expect(first.requestId).not.toBe(second.requestId);
    expect(adaptTdmsDailySource(first).envelope).toEqual(first);
    expect(adaptTdmsDailySource(second).envelope).toEqual(second);
    expect(
      render('unreviewed-render-', 100).package.records[0].snapshotId,
    ).not.toBe(render('unreviewed-render-', 200).package.records[0].snapshotId);
    const literal = copyComplete(second),
      proof = proofOf(literal);
    for (const read of proof.reads)
      Object.assign(read.fields[0].value, {
        rawValue: 'infoPage_myTab_tab_jcaGen_200',
        observedTotalCodepoints: 29,
      });
    literal.package.records[0].content.completeOwnedFields = copyComplete(
      proof.reads[1].fields,
    );
    sealComplete(literal);
    expect(literal.package.records[0].snapshotId).not.toBe(
      second.package.records[0].snapshotId,
    );
    expect(adaptTdmsDailySource(literal).envelope).toEqual(literal);
  });
  it.each([
    'missing-version-field',
    'version-field-mismatch',
    'missing-classification-operation',
    'wrong-header-version',
  ])(
    'rejects current own DTO %s rather than reusing old owner evidence',
    (change) => {
      const env = syntheticCompleteEnvelope('EO'),
        proof = proofOf(env);
      for (const read of proof.reads) {
        if (change === 'missing-version-field')
          delete read.owner.technicalVersionFieldEvidence;
        if (change === 'version-field-mismatch')
          Object.assign(read.owner.technicalVersionFieldEvidence, {
            state: 'VALUE',
            rawValue: 'B.1',
            observedTotalCodepoints: 3,
          });
        if (change === 'wrong-header-version')
          read.owner.rawHeaderIdentifier = 'SYNTHETIC-901, B.1';
      }
      if (change === 'missing-classification-operation')
        delete (proof.requestedCriteria as any).sourceProof
          .classificationOperationId;
      sealComplete(env);
      expect(() => adaptTdmsDailySource(env)).toThrow();
    },
  );
  it('accepts concrete native status class evidence and refuses an invented WCTYPE binding', async () => {
    const env = syntheticCompleteEnvelope('AIRCRAFT_STATUS'),
      proof = proofOf(env),
      binding = 'com.airchina.tdms.statuslink.TDMSStatusLink';
    (proof.requestedCriteria as any).expectedOwner.nativeTypeId = binding;
    for (const read of proof.reads) {
      read.owner.nativeTypeId = binding;
      Object.assign(read.owner.nativeTypeEvidence, {
        state: 'VALUE',
        actualLabel: 'Native Class:',
        rawValue: binding,
        observedTotalCodepoints: binding.length,
      });
    }
    for (const coverage of [
      env.package.coverage,
      env.package.records[0].coverage,
    ])
      coverage.gaps = coverage.gaps.filter(
        (g) => g !== 'NATIVE_TYPE_UNOBSERVED',
      );
    sealComplete(env);
    const s = setup(env);
    await s.service.importDailyMetadata(actor(), env);
    expect(s.repository.state.revisions[0].record.recordKind).toBe(
      'OBSERVATION',
    );
    const changed = copyComplete(env),
      changedProof = proofOf(changed),
      invented = 'WCTYPE|' + binding + '|Synthetic';
    (changedProof.requestedCriteria as any).expectedOwner.nativeTypeId =
      invented;
    for (const read of changedProof.reads) {
      read.owner.nativeTypeId = invented;
      Object.assign(read.owner.nativeTypeEvidence, {
        rawValue: invented,
        observedTotalCodepoints: invented.length,
      });
    }
    sealComplete(changed);
    expect(() => adaptTdmsDailySource(changed)).toThrow();
  });
  it('retains reused status dates and column tokens as raw relation evidence without certifying execution', async () => {
    const env = withReusedStatus(),
      s = setup(env);
    const receipt = await s.service.importDailyMetadata(actor(), env);
    expect(receipt.relationCount).toBe(1);
    expect(
      (await s.service.readDailyMetadataImport(actor(), env.requestId)).package,
    ).toEqual(env.package);
    expect(s.repository.state.captures[0].receipt.executionVerified).toBe(
      false,
    );
    expect(s.repository.state.revisions[0].record.coverage.status).toBe(
      'PARTIAL',
    );
    const native = copyComplete(adaptTdmsDailySource(env).output.nativePackage);
    const rawProof = native.records[0].rawFields.completeOwnedSource as any;
    rawProof.reads[1].relationTables[0].nativeStatusProof.statusTable.complete = false;
    expect(() => sourcePackage(native)).toThrow(
      'TDMS_ENGINEERING_REUSED_STATUS_INVALID',
    );
  });
  it.each([
    'owner-version',
    'count',
    'document-number',
    'missing-target',
    'column-role',
    'column-token',
    'status-complete',
    'feedback-pair',
  ])('rejects reused native status %s before import', (change) => {
    const env = withReusedStatus(),
      proof = proofOf(env);
    for (const read of proof.reads) {
      const table = read.relationTables[0],
        status = table.nativeStatusProof.statusTable;
      if (change === 'owner-version')
        table.nativeStatusProof.ownerSourceVersion.rawRevision = 'B';
      if (change === 'count') status.reportedCount = 2;
      if (change === 'document-number')
        status.rows[0].executionStatus.engineeringDocumentNumber = 'OTHER';
      if (change === 'missing-target')
        table.rows[0].sourceLinks[0].targetRef =
          'OR:com.airchina.tdms.statuslink.TDMSStatusLink:998';
      if (change === 'column-role')
        table.rows[0].sourceLinks[0].nativeRole = 'RELATED';
      if (change === 'column-token')
        table.rows[0].sourceLinks[0].nativeColumnToken = 'feedbackOid';
      if (change === 'status-complete') status.complete = false;
      if (change === 'feedback-pair')
        status.rows[0].executionStatus.feedbackNumber = null;
    }
    sealRelationEnvelope(env);
    const expected = {
      'owner-version': 'TDMS_COMPLETE_ENGINEERING_REUSED_STATUS_UNVERIFIED',
      count: 'TDMS_ENGINEERING_REUSED_STATUS_INVALID',
      'document-number': 'TDMS_ENGINEERING_STATUS_VERSION_MISMATCH',
      'missing-target': 'TDMS_COMPLETE_ENGINEERING_REUSED_STATUS_UNVERIFIED',
      'column-role': 'TDMS_COMPLETE_RELATION_ROLE_INVALID',
      'column-token': 'TDMS_COMPLETE_RELATION_ROLE_INVALID',
      'status-complete': 'TDMS_ENGINEERING_REUSED_STATUS_INVALID',
      'feedback-pair': 'TDMS_ENGINEERING_STATUS_VERSION_MISMATCH',
    }[change];
    expect(() => adaptTdmsDailySource(env)).toThrow(expected);
  });
});
