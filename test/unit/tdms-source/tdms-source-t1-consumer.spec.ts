import { prepareTdmsDailySourceImport } from '../../../server/modules/tdms-source/tdms-daily-metadata-contract';
import { adaptTdmsDailySource } from '../../../server/modules/tdms-source/tdms-daily-source-adapter';
import { TdmsSourceService } from '../../../server/modules/tdms-source/tdms-source.service';
import { HostDecisionTdmsSourceAuthorization } from '../../../server/modules/tdms-source/tdms-source.authorization';
import {
  completeOwnedTargetOccurrences,
  completeOwnedObservedEdges,
} from '../../../server/modules/tdms-source/tdms-complete-owned-source.validation';
import { MemoryTdmsRepository, nativeScope } from './tdms-memory-double';
import { actor } from './tdms-fixtures';
import {
  proofOfCurrent,
  resealClassification,
} from './tdms-current-contract.fixture';
import {
  copyComplete,
  sealComplete,
  syntheticCompleteEnvelope,
} from './tdms-complete-owned.fixture';
import {
  syntheticAnonymous,
  syntheticHandlingClassification,
  syntheticHandlingTree,
  resealT1,
} from './tdms-source-t1.fixture';
import {
  syntheticEfQueries,
  syntheticEfRelated,
  syntheticEfAliases,
} from './tdms-source-t1-ef.fixture';

const validate = prepareTdmsDailySourceImport;
function setup(env: ReturnType<typeof syntheticAnonymous>) {
  const claims = adaptTdmsDailySource(env).memberClaims;
  const repository = new MemoryTdmsRepository();
  const state = {
    canImport: true,
    canRead: true,
    permissionRevision: 'synthetic-t1-1',
  };
  const authority = new HostDecisionTdmsSourceAuthorization(
    async ({ action }) =>
      !state.canRead && action !== 'IMPORT'
        ? []
        : [
            {
              scope: nativeScope,
              permissionRevision: state.permissionRevision,
            },
          ],
    async ({ grant }) => ({
      ...grant,
      authorityRef: 'synthetic-t1-import',
      captureRetentionAllowed: true,
      nativeProjectionAllowed: true,
      permittedMembers: state.canImport
        ? claims
        : { records: [], relationIds: [], artifacts: [] },
    }),
    async ({ grant }) => ({
      ...grant,
      authorityRef: 'synthetic-t1-read',
      retainedCaptureReadAllowed: true,
      permittedMembers: state.canRead
        ? claims
        : { records: [], relationIds: [], artifacts: [] },
    }),
  );
  const artifacts = { acquire: jest.fn() };
  const documents = { assertRead: jest.fn() };
  return {
    repository,
    state,
    artifacts,
    documents,
    service: new TdmsSourceService(repository, authority, artifacts, documents),
  };
}

describe('T1 frozen Source pure contracts through actual Host consumers (synthetic, no PG/source)', () => {
  it.each([
    ['AD classification', syntheticHandlingClassification],
    ['EF exact anonymous raw', syntheticAnonymous],
    ['EF four native default queries', syntheticEfQueries],
    ['EF four unresolved related surfaces', syntheticEfRelated],
    ['EF three exact component aliases', syntheticEfAliases],
  ] as const)(
    'retains the %s package through prepare, adapter, service and receipt',
    async (_name, factory) => {
      const env = factory(),
        before = JSON.stringify(env);
      expect(validate(env).envelope).toEqual(env);
      const native = adaptTdmsDailySource(env).output.nativePackage;
      expect(native.coverage.status).toBe('PARTIAL');
      expect(native.query.scopeMatch).toBe('UNKNOWN');
      const h = setup(env),
        receipt = await h.service.importDailyMetadata(actor(), env);
      const saved = await h.service.readDailySourceRef(
        actor(),
        receipt.sourceRefs[0]!,
      );
      expect(saved).toBeDefined();
      expect(JSON.stringify(env)).toBe(before);
      expect(h.repository.state.captures).toHaveLength(1);
      expect(h.artifacts.acquire).not.toHaveBeenCalled();
      expect(h.documents.assertRead).not.toHaveBeenCalled();
    },
  );
  it('preserves partial AD hierarchy and exports only its direct child; native full-body admission remains refused', async () => {
    const env = syntheticHandlingTree(),
      before = JSON.stringify(env);
    expect(validate(env).envelope).toEqual(env);
    const p = proofOfCurrent(env),
      occurrences = completeOwnedTargetOccurrences(p);
    expect(occurrences).toHaveLength(4);
    expect(occurrences[1].relationshipRole).toBe('OUT_OF_SCOPE_REFERENCE');
    expect(
      occurrences.every(
        (o) =>
          o.direction === 'UNKNOWN' &&
          o.rawRole === null &&
          o.sourceVersion.confirmation === 'VERSION_UNCONFIRMED',
      ),
    ).toBe(true);
    const edges = completeOwnedObservedEdges(env.package.records[0]);
    expect(edges).toHaveLength(1);
    expect(edges[0].toSourceRecordId).toBe(
      'OR:wt.change2.WTChangeOrder2:991003',
    );
    expect(p.reads[1].relationTables[0].terminal.kind).toBe('UNCONFIRMED');
    expect(() => adaptTdmsDailySource(env)).toThrow(
      'TDMS_SOURCE_BODY_OWNER_UNCONFIRMED',
    );
    const h = setup(syntheticHandlingClassification());
    await expect(h.service.importDailyMetadata(actor(), env)).rejects.toThrow(
      'TDMS_SOURCE_BODY_OWNER_UNCONFIRMED',
    );
    expect(h.repository.state.captures).toHaveLength(0);
    expect(h.repository.state.revisions).toHaveLength(0);
    expect(JSON.stringify(env)).toBe(before);
  });

  it('preserves exact anonymous caption and blank codepoints in both reviewed native slots; unrelated BLANK stays strict', () => {
    for (const scope of ['ENGINEERING_ASSESSMENT', 'AD']) {
      const env = syntheticAnonymous(scope),
        before = JSON.stringify(env);
      const p = proofOfCurrent(env),
        f = p.reads[1].fields.find(
          (v: { rawCaptionText?: string }) => v.rawCaptionText !== undefined,
        );
      expect(f.value.rawValue).toBe(' \u00a0\t');
      expect(f.value.observedTotalCodepoints).toBe(3);
      expect(f.rawCaptionText).toBe(' \u00a0 ');
      expect(validate(env).envelope).toEqual(env);
      expect(
        adaptTdmsDailySource(env).output.nativePackage.records[0]!.content
          .completeOwnedFields,
      ).toEqual(p.reads[1].fields);
      expect(JSON.stringify(env)).toBe(before);
    }
    const unrelated = syntheticCompleteEnvelope();
    for (const read of proofOfCurrent(unrelated).reads) {
      read.fields[1].value.rawValue = '\u00a0';
      read.fields[1].value.observedTotalCodepoints = 1;
    }
    sealComplete(unrelated);
    expect(() => validate(unrelated)).toThrow(
      'TDMS_COMPLETE_OWN_FIELD_STATE_INVALID',
    );
  });

  it.each([
    'owner',
    'state',
    'observed-at',
    'purpose',
    'extra-key',
    'caption',
    'count',
    'slot',
    'duplicate',
    'roster',
    'one-read',
  ])(
    'rejects anonymous raw %s through the actual record consumer',
    (change) => {
      const env = syntheticAnonymous(),
        p = proofOfCurrent(env);
      for (const read of p.reads) {
        const f = read.fields.find(
            (v: { rawTextQualification?: unknown }) =>
              v.rawTextQualification !== undefined,
          ),
          q = f.rawTextQualification;
        if (change === 'owner')
          q.ownerSourceRecordId =
            p.requestedCriteria.sourceProof?.parentSourceRecordId ??
            'OR:wt.doc.WTDocument:991099';
        if (change === 'state') q.ownStateRaw = 'Approved';
        if (change === 'observed-at') q.observedAt = '2026-10-14T00:00:00.000Z';
        if (change === 'purpose') q.semanticPurpose = 'ASSESSMENT_OPINION';
        if (change === 'extra-key') q.authorized = true;
        if (change === 'caption') f.rawCaptionText = 'Description:';
        if (change === 'count') f.value.observedTotalCodepoints = 0;
        if (change === 'slot') {
          f.fieldId += ' wrong';
          f.value.locator = f.fieldId;
        }
        if (change === 'duplicate') read.fields.push(copyComplete(f));
        if (change === 'roster')
          read.rosterEvidence.structuralRosters
            .find((r: { tabId: string }) => r.tabId === f.tabId)
            .before.fieldIds.pop();
        if (change === 'one-read') {
          q.ownStateRaw = 'Approved';
          break;
        }
      }
      sealComplete(env);
      expect(() => validate(env)).toThrow('TDMS_');
    },
  );

  it.each(['Approved', '已批准', 'Estimating'])(
    'keeps native body admission separate from raw %s capture eligibility',
    async (state) => {
      const env = syntheticAnonymous('ENGINEERING_ASSESSMENT', state),
        before = JSON.stringify(env);
      expect(validate(env).envelope).toEqual(env);
      expect(() => adaptTdmsDailySource(env)).toThrow(
        'TDMS_UNAPPROVED_ASSESSMENT_BODY_FORBIDDEN',
      );
      const h = setup(syntheticAnonymous());
      await expect(h.service.importDailyMetadata(actor(), env)).rejects.toThrow(
        'TDMS_UNAPPROVED_ASSESSMENT_BODY_FORBIDDEN',
      );
      expect(h.repository.state.revisions).toHaveLength(0);
      expect(h.artifacts.acquire).not.toHaveBeenCalled();
      expect(JSON.stringify(env)).toBe(before);
    },
  );

  it.each([
    'business-mirror',
    'created',
    'modified',
    'own-ref',
    'unknown-type',
    'classification-revision',
    'one-read',
    'borrow-parent-version',
  ])(
    'rejects AD classification %s without using its parent or guessing technical identity',
    (change) => {
      const env = syntheticHandlingClassification(),
        p = env.package.records[0]!.rawFields
          .documentTargetClassification as ReturnType<typeof proofOfCurrent>;
      for (const read of p.reads) {
        if (change === 'business-mirror')
          read.ownMetadataFields.find(
            (f: { sectionId: string; value: { actualLabel: string } }) =>
              f.sectionId.endsWith('::Justification') &&
              f.value.actualLabel === 'AD处理单版本:',
          ).value.rawValue = '2';
        if (change === 'created') read.owner.sourceCreatedRaw = 'borrowed';
        if (change === 'modified') read.owner.sourceModifiedRaw = 'borrowed';
        if (change === 'own-ref')
          read.owner.sourceRecordId =
            p.requestedCriteria.sourceProof.parentSourceRecordId;
        if (change === 'unknown-type')
          read.owner.nativeTypeId =
            'WCTYPE|wt.change2.WTChangeRequest2|guessed.Native';
        if (change === 'classification-revision')
          p.classificationRevision =
            p.requestedCriteria.classificationRevision =
              'tdms-required-ad-handling-own-classification@2';
        if (change === 'borrow-parent-version')
          read.owner.sourceVersion = copyComplete(
            p.requestedCriteria.sourceProof.parentSourceVersion,
          );
        if (change === 'one-read') {
          read.owner.stateRaw = 'Approved';
          break;
        }
      }
      resealClassification(env);
      expect(() => validate(env)).toThrow('TDMS_');
    },
  );

  it.each([
    'parent-path',
    'self-number',
    'href',
    'number-token',
    'non-number-text',
    'terminal',
    'role',
    'direction',
    'duplicate-ref',
    'unreviewed-expansion',
  ])(
    'rejects AD tree %s while keeping its unresolved terminal/relationship evidence',
    (change) => {
      const env = syntheticHandlingTree(),
        p = proofOfCurrent(env);
      for (const read of p.reads) {
        const table = read.relationTables[0];
        if (change === 'parent-path')
          table.rows[2].treePath[1] = 'OR:wt.change2.WTChangeRequest2:999000';
        if (change === 'self-number')
          table.rows[1].sourceLinks[0].numberRaw = 'wrong';
        if (change === 'href')
          table.rows[2].sourceLinks[0].rawHref =
            '/Windchill/tcomp/infoPage?oid=OR:wt.change2.WTChangeOrder2:999000';
        if (change === 'number-token')
          table.rows[2].sourceLinks[0].nativeColumnToken =
            'primaryAttachmentProperties';
        if (change === 'non-number-text') {
          const c = table.rows[2].cells[4];
          c.state = 'VALUE';
          c.rawValue = 'read';
          c.observedTotalCodepoints = 4;
        }
        if (change === 'terminal') {
          table.enumerationState = 'VALUE';
          table.terminal.nativeTerminal = true;
        }
        if (change === 'role') table.relationshipRole = 'UNKNOWN';
        if (change === 'direction') table.direction = 'SOURCE_TO_TARGET';
        if (change === 'duplicate-ref')
          table.rows[3].sourceLinks[0].targetRef =
            table.rows[2].sourceLinks[0].targetRef;
        if (change === 'unreviewed-expansion')
          table.treeExpansions.push({ nativeRowId: 'guessed' });
      }
      sealComplete(env);
      expect(() => validate(env)).toThrow('TDMS_');
    },
  );

  it.each([
    'filtered',
    'selected-only',
    'count',
    'hidden-rows',
    'pager',
    'scroller',
    'loading',
    'permission',
    'owner',
    'version',
    'wrong-window',
    'one-read',
  ])(
    'rejects EF default-query %s before a zero/end assertion can be adopted',
    (change) => {
      const env = syntheticEfQueries(),
        p = proofOfCurrent(env);
      for (const read of p.reads) {
        const q = read.relationTables[1].efQueryEvidence;
        if (change === 'owner')
          q.ownerSourceRecordId = 'OR:wt.doc.WTDocument:999111';
        if (change === 'version') q.ownerSourceVersion.rawIteration = '9';
        if (change === 'wrong-window') q.windows[0].windowOrdinal = 1;
        for (const frame of [q.windows[0].before, q.windows[0].after]) {
          if (change === 'filtered') {
            frame.search.rawValue = 'filtered';
            frame.search.normalization = 'FILTERED';
          }
          if (change === 'selected-only')
            frame.selectedOnly.item.rawClassName += ' x-menu-item-checked';
          if (change === 'count') frame.counts[0].rawText = '(1 object)';
          if (change === 'hidden-rows') frame.structure.hiddenRows = 1;
          if (change === 'pager')
            frame.structure.pagers.push({
              id: 'pager',
              tag: 'DIV',
              rawClassName: '',
              visible: true,
            });
          if (change === 'scroller') frame.structure.scrollers[0].height = 200;
          if (change === 'loading')
            frame.loading.masks.push({
              id: 'mask',
              tag: 'DIV',
              rawClassName: '',
              visible: true,
            });
          if (change === 'permission')
            frame.permissionMarkers.push({
              id: 'denied',
              tag: 'DIV',
              rawClassName: '',
              visible: true,
            });
          if (change === 'one-read') {
            frame.search.rawValue = 'filtered';
            frame.search.normalization = 'FILTERED';
            break;
          }
        }
      }
      sealComplete(env);
      expect(() => validate(env)).toThrow('TDMS_');
    },
  );

  it('retains a truthful filtered query as PARTIAL with no native zero/end promotion', () => {
    const env = syntheticEfQueries(),
      p = proofOfCurrent(env);
    for (const read of p.reads) {
      const table = read.relationTables[1];
      for (const frame of [
        table.efQueryEvidence.windows[0].before,
        table.efQueryEvidence.windows[0].after,
      ]) {
        frame.search.rawValue = 'filtered';
        frame.search.normalization = 'FILTERED';
      }
      Object.assign(table, {
        enumerationState: 'NOT_READ',
        stopReason: 'TDMS_EFREQUEST_QUERY_FILTERED',
      });
      Object.assign(table.terminal, {
        kind: 'UNCONFIRMED',
        nativeTerminal: false,
        trueZero: false,
      });
    }
    resealT1(env);
    const native = adaptTdmsDailySource(env).output.nativePackage;
    expect(native.coverage.status).toBe('PARTIAL');
    expect(native.coverage.gaps).toContain('RELATION_ENUMERATION_UNVERIFIED');
    expect(
      proofOfCurrent(env).reads[1].relationTables[1].efQueryEvidence.windows[0]
        .after.search.rawValue,
    ).toBe('filtered');
  });

  it.each([
    'owner',
    'version',
    'query-complete',
    'table-complete',
    'token',
    'row-body',
    'href',
    'one-read',
  ])(
    'rejects EF unresolved related-surface %s without converting its role or target version',
    (change) => {
      const env = syntheticEfRelated(),
        p = proofOfCurrent(env);
      for (const read of p.reads) {
        const table = read.relationTables[4],
          proof = table.relatedSurfaceEvidence;
        if (change === 'owner')
          proof.ownerSourceRecordId = 'OR:wt.doc.WTDocument:992999';
        if (change === 'version')
          table.rows[0].observedVersion = {
            rawRevision: 'A',
            rawIteration: '1',
            confirmation: 'SOURCE_DECLARED',
          };
        if (change === 'query-complete') proof.queryReviewState = 'VALUE';
        if (change === 'table-complete') table.enumerationState = 'VALUE';
        if (change === 'token')
          table.rows[0].sourceLinks[0].nativeColumnToken = 'infoPageAction';
        if (change === 'row-body') {
          const c = table.rows[0].cells[0];
          c.state = 'VALUE';
          c.rawValue = 'read';
          c.observedTotalCodepoints = 4;
        }
        if (change === 'href') {
          table.rows[0].sourceLinks[0].rawHref +=
            '&oid=OR:wt.doc.WTDocument:992999';
          proof.after.owner = 'unexpected';
        }
        if (change === 'one-read') proof.before.panelVisible = false;
      }
      sealComplete(env);
      expect(() => validate(env)).toThrow('TDMS_');
    },
  );

  it.each([
    'owner',
    'canonical-version',
    'canonical-missing',
    'false-body-read',
    'embedded',
    'missing-proof',
    'wrong-alias',
    'one-read',
  ])(
    'rejects EF component alias %s instead of silently hiding its canonical content',
    (change) => {
      const env = syntheticEfAliases(),
        p = proofOfCurrent(env);
      for (const read of p.reads) {
        const tab = read.tabs.find(
            (t: { purposeEvidence?: unknown }) =>
              t.purposeEvidence !== undefined,
          ),
          proof = tab.purposeEvidence;
        if (change === 'owner')
          proof.ownerSourceRecordId = 'OR:wt.doc.WTDocument:992999';
        if (change === 'canonical-version')
          proof.canonicalBinding.ownerSourceVersion.rawIteration = '9';
        if (change === 'canonical-missing')
          proof.canonicalBinding.tableId = 'not-present';
        if (change === 'false-body-read') proof.bodyEvidenceState = 'VALUE';
        if (change === 'embedded') {
          proof.before.embedded.push('unreviewed');
          proof.after.embedded.push('unreviewed');
        }
        if (change === 'missing-proof') delete tab.purposeEvidence;
        if (change === 'wrong-alias') tab.tabId += '-wrong';
        if (change === 'one-read') proof.before.panelVisible = false;
      }
      sealComplete(env);
      expect(() => validate(env)).toThrow('TDMS_');
    },
  );

  it('keeps new Source record identity, exact receipt replay and current member rejection in the existing service', async () => {
    const env = syntheticAnonymous(),
      h = setup(env),
      user = actor();
    const receipt = await h.service.importDailyMetadata(user, env);
    expect(await h.service.importDailyMetadata(user, env)).toEqual(receipt);
    expect(h.repository.state.captures).toHaveLength(1);
    expect(h.repository.state.revisions).toHaveLength(1);
    const ref = h.repository.state.revisions[0]!.record.sourceRevisionRef;
    const read = await h.service.readRecord(user, ref);
    expect(read.record.sourceRecordId).toBe(
      env.package.records[0]!.sourceRecordId,
    );
    expect(read.bodyReadPolicy.kind).toBe('ESTIMATED_ASSESSMENT');
    h.state.canRead = false;
    await expect(
      h.service.readDailySourceRef(user, receipt.sourceRefs[0]!),
    ).rejects.toThrow('TDMS_');
    await expect(h.service.readRecord(user, ref)).rejects.toThrow('TDMS_');
    h.state.canImport = false;
    await expect(h.service.importDailyMetadata(user, env)).rejects.toThrow(
      'TDMS_',
    );
    expect(h.repository.state.revisions).toHaveLength(1);
  });
});
