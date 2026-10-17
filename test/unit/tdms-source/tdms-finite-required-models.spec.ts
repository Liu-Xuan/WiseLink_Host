import { prepareTdmsDailySourceImport } from '../../../server/modules/tdms-source/tdms-daily-metadata-contract';
import { adaptTdmsDailySource } from '../../../server/modules/tdms-source/tdms-daily-source-adapter';
import { completeOwnedTargetOccurrences } from '../../../server/modules/tdms-source/tdms-complete-owned-source.validation';
import {
  validateReviewedCompleteTabPurposes,
  validateReviewedEfRequestGridRosters,
  validateReviewedAdModifiedMirrors,
} from '../../../server/modules/tdms-source/tdms-reviewed-complete-source-types';
import { TdmsSourceService } from '../../../server/modules/tdms-source/tdms-source.service';
import { HostDecisionTdmsSourceAuthorization } from '../../../server/modules/tdms-source/tdms-source.authorization';
import { MemoryTdmsRepository, nativeScope } from './tdms-memory-double';
import { actor } from './tdms-fixtures';
import {
  copyComplete,
  syntheticCompleteEnvelope,
  sealComplete,
} from './tdms-complete-owned.fixture';
import {
  efRequestProof,
  efRequestStructuralRosters,
  resealEfRequest,
} from './tdms-efrequest-contract.fixture';
import { proofOfCurrent, resealCurrent } from './tdms-current-contract.fixture';
import {
  finiteModelsGolden as golden,
  syntheticFiniteEfRequest,
  syntheticFiniteRawControl,
} from './tdms-finite-required-models.fixture';

const validate = prepareTdmsDailySourceImport;
const raw = golden.acceptedControls[2].rawControlObservations[0];
const editEf = (fn: (r: any) => void, rows = false) => {
  const env = syntheticFiniteEfRequest(rows);
  for (const read of efRequestProof(env).reads) {
    fn(read);
    efRequestStructuralRosters(read);
  }
  return resealEfRequest(env);
};

describe('finite Source models consumed by the existing Host wire (synthetic only)', () => {
  it('matches Source pure model results without a Host-generated model fixture', () => {
    expect(
      validateReviewedCompleteTabPurposes({
        scopeId: golden.efModel.scopeId,
        owner: golden.owner,
        read: golden.read,
      }),
    ).toBe(golden.results.tabPurposes);
    const read = efRequestProof(syntheticFiniteEfRequest()).reads[1];
    expect(
      validateReviewedEfRequestGridRosters({
        scopeId: golden.efModel.scopeId,
        owner: read.owner,
        read,
      }),
      // The prior golden qualifies the original four grids only. The new frozen
      // related-surface roster adds four independently required observations.
    ).toBe(false);
    expect(
      validateReviewedEfRequestGridRosters({
        scopeId: golden.efModel.scopeId,
        owner: read.owner,
        read: { relationTables: [] },
      }),
    ).toBe(golden.results.gridsAbsent);
    expect(
      validateReviewedAdModifiedMirrors({
        scopeId: golden.adModel.scopeId,
        owner: golden.adOwner,
        fields: golden.adFields,
        sections: golden.adSections,
      }),
    ).toEqual(golden.results.adMirrors);
  });

  it.each([
    undefined,
    [],
    ...golden.acceptedControls.map((v) => v.rawControlObservations),
  ])(
    'retains absent/empty/blank/verbatim raw controls without asserting reviewed filters',
    (controls) => {
      const env = syntheticFiniteRawControl(controls),
        before = JSON.stringify(env);
      const prepared = validate(env),
        native = adaptTdmsDailySource(env).output.nativePackage.records[0];
      const v = (native.rawFields.completeOwnedSource as any).reads[1]
        .relationTables[0].sourceViewEvidence;
      expect(prepared.envelope).toEqual(env);
      expect(JSON.stringify(env)).toBe(before);
      if (controls === undefined)
        expect(v).not.toHaveProperty('rawControlObservations');
      else expect(v.rawControlObservations).toEqual(controls);
      expect(v.state).toBe('NOT_READ');
      expect(v.nativeView.control).toBeNull();
      expect(v.nativeFilters.state).toBe('NOT_READ');
      expect(native.coverage.status).toBe('PARTIAL');
      expect(native.coverage.gaps).toContain(
        'COMPLETION_CERTIFICATE_NOT_ISSUED',
      );
    },
  );

  it.each([
    'null',
    'duplicate',
    'extra-key',
    'tag',
    'locator',
    'label-type',
    'label-limit',
    'value-limit',
    'wrong-blank',
    'wrong-value',
    'owner',
    'version',
    'no-filter-promotion',
  ])(
    'rejects raw control %s without weakening existing owner/view binding',
    (change) => {
      const env = syntheticFiniteRawControl([raw]);
      for (const r of proofOfCurrent(env).reads) {
        const v = r.relationTables[0].sourceViewEvidence,
          c = v.rawControlObservations[0];
        if (change === 'null') v.rawControlObservations = null;
        if (change === 'duplicate')
          v.rawControlObservations.push(copyComplete(c));
        if (change === 'extra-key') c.reviewed = true;
        if (change === 'tag') c.tag = 'SPAN';
        if (change === 'locator') c.locator += ' a';
        if (change === 'label-type') c.actualLabel = 3;
        if (change === 'label-limit') c.actualLabel = 'x'.repeat(701);
        if (change === 'value-limit') c.rawValue = 'x'.repeat(1001);
        if (change === 'wrong-blank') {
          c.rawValue = ' \t ';
          c.state = 'VALUE';
        }
        if (change === 'wrong-value') c.state = 'BLANK';
        if (change === 'owner')
          v.ownerSourceRecordId = 'OR:wt.epm.EPMDocument:1234';
        if (change === 'version') v.ownerTechnicalVersion.rawIteration = '9';
        if (change === 'no-filter-promotion')
          v.nativeFilters = {
            state: 'NONE',
            controls: [],
            noFilterDeclaration: null,
          };
      }
      resealCurrent(env);
      expect(() => validate(env)).toThrow(
        'TDMS_COMPLETE_RELATED_STATUS_VIEW_INVALID',
      );
    },
  );

  it.each([false, true])(
    'accepts exact EFRequest four grids, rows=%s, and retains UNKNOWN roles/unread text',
    (rows) => {
      const env = syntheticFiniteEfRequest(rows),
        before = JSON.stringify(env),
        prepared = validate(env);
      expect(prepared.envelope).toEqual(env);
      expect(JSON.stringify(env)).toBe(before);
      const record = adaptTdmsDailySource(env).output.nativePackage.records[0],
        proof = record.rawFields.completeOwnedSource as any;
      expect(proof.reads[1].relationTables).toHaveLength(4);
      expect(proof.reads[1].tabs.filter((t: any) => !t.required)).toHaveLength(
        4,
      );
      for (const table of proof.reads[1].relationTables) {
        expect(table.relationshipRole).toBe('UNKNOWN');
        expect(table.direction).toBe('UNKNOWN');
      }
      expect(record.coverage.status).toBe('PARTIAL');
      expect(record.coverage.gaps).toContain(
        'COMPLETION_CERTIFICATE_NOT_ISSUED',
      );
      expect(record.coverage.gaps).not.toContain('OWN_CONTENT_UNREAD');
      expect(
        proof.reads[1].tabs
          .filter((t: any) => !t.required)
          .every((t: any) => t.state === 'NOT_READ'),
      ).toBe(true);
    },
  );

  it.each([
    'arbitrary-tab',
    'label',
    'panel',
    'state',
    'reason',
    'pair-absent',
    'field-body',
    'section-body',
    'table-body',
    'attachment-body',
    'structural-body',
  ])('rejects excluded EFRequest tab %s', (change) => {
    const env = editEf((r) => {
      const t = r.tabs.find((x: any) => !x.required);
      if (change === 'arbitrary-tab') {
        t.tabId += '-other';
        r.rosterEvidence.tabIds = r.tabs.map((tab: any) => tab.tabId);
        r.rosterEvidence.nativeTabStripIds = [
          ...r.rosterEvidence.tabIds,
          golden.efModel.nonContentControl.actionId,
        ];
      }
      if (change === 'label') t.label += 'other';
      if (change === 'panel') t.panelLocator += '-other';
      if (change === 'state') t.state = 'VALUE';
      if (change === 'reason') t.reasonCode = 'CALLER_OPTIONAL';
      if (change === 'pair-absent') {
        delete r.rosterEvidence.nativeTabStripIds;
        delete r.rosterEvidence.nonContentControls;
      }
      if (change === 'field-body') r.fields[0].tabId = t.tabId;
      if (change === 'section-body') r.sections[0].tabId = t.tabId;
      if (change === 'table-body') r.relationTables[0].tabId = t.tabId;
      if (change === 'attachment-body')
        r.attachments.push({
          ownerSourceRecordId: r.owner.sourceRecordId,
          sourceVersion: copyComplete(r.owner.sourceVersion),
          sourceAttachmentId: null,
          role: 'SECONDARY',
          filename: null,
          rawHref: null,
          locator: t.panelLocator + ' a.synthetic',
          state: 'NOT_READ',
        });
    });
    if (change === 'structural-body')
      for (const r of efRequestProof(env).reads)
        r.rosterEvidence.structuralRosters.push({
          tabId: r.tabs.find((t: any) => !t.required).tabId,
        });
    sealComplete(env);
    expect(() => validate(env)).toThrow(
      'TDMS_REVIEWED_COMPLETE_TAB_PURPOSE_INVALID',
    );
  });

  it('rejects arbitrary optional tabs in a non-EFRequest owner', () => {
    const env = syntheticCompleteEnvelope('SB');
    for (const read of proofOfCurrent(env).reads) read.tabs[0].required = false;
    sealComplete(env);
    expect(() => validate(env)).toThrow(
      'TDMS_REVIEWED_COMPLETE_TAB_PURPOSE_INVALID',
    );
  });

  it.each([
    'wrong-tab',
    'wrong-panel',
    'role',
    'direction',
    'column-order',
    'column-label',
    'duplicate-grid',
    'attachment-text',
    'description',
    'comments',
    'text-link',
    'link-token',
  ])('rejects EFRequest grid %s even for Approved parent', (change) => {
    const env = editEf((r) => {
      r.owner.stateRaw = 'Approved';
      const table = r.relationTables[3],
        cell = table.rows[0].cells[10];
      if (change === 'wrong-tab') table.tabId = r.relationTables[0].tabId;
      if (change === 'wrong-panel') table.panelLocator += '-other';
      if (change === 'role') table.relationshipRole = 'CURRENT_CONTENT';
      if (change === 'direction') table.direction = 'SOURCE_TO_TARGET';
      if (change === 'column-order')
        [table.rawHeaders[1], table.rawHeaders[2]] = [
          table.rawHeaders[2],
          table.rawHeaders[1],
        ];
      if (change === 'column-label') table.rawHeaders[10] = 'Assessed Opinion';
      if (change === 'duplicate-grid')
        r.relationTables.push(copyComplete(table));
      if (change === 'attachment-text') {
        const c = r.relationTables[1].rows[0].cells[5];
        c.state = 'VALUE';
        c.rawValue = 'Caller text';
        c.observedTotalCodepoints = 11;
      }
      if (change === 'description' || change === 'comments') {
        const c = change === 'description' ? cell : table.rows[0].cells[11];
        c.state = 'VALUE';
        c.rawValue = 'Caller text';
        c.observedTotalCodepoints = 11;
      }
      if (change === 'text-link' || change === 'link-token')
        table.rows[0].sourceLinks.push({
          rawHref: '/infoPage?oid=OR:wt.doc.WTDocument:249999',
          targetRef: 'OR:wt.doc.WTDocument:249999',
          numberRaw: 'SYNTHETIC',
          nativeRole: 'RELATED',
          locator: table.panelLocator + ' a.synthetic',
          nativeColumnLabel:
            change === 'text-link' ? 'Comments' : 'EFR Document Number',
          nativeColumnToken: change === 'text-link' ? 'comments' : 'docNumber',
        });
    }, true);
    expect(() => validate(env)).toThrow();
  });

  it('leaves missing EF grids explicitly unresolved, never issues a completion certificate', () => {
    const env = editEf((r) => {
      r.relationTables.pop();
    });
    const native = adaptTdmsDailySource(env).output.nativePackage.records[0];
    expect(native.coverage.status).toBe('PARTIAL');
    expect(native.coverage.gaps).toContain('COMPLETION_CERTIFICATE_NOT_ISSUED');
    const r = efRequestProof(env).reads[1];
    expect(
      validateReviewedEfRequestGridRosters({
        scopeId: 'ENGINEERING_ASSESSMENT',
        owner: r.owner,
        read: r,
      }),
    ).toBe(false);
  });

  it('retains a correctly bound native grid link as an UNKNOWN candidate relation', () => {
    const env = editEf((r) => {
      const table = r.relationTables[3];
      table.rows[0].sourceLinks.push({
        rawHref: '/infoPage?oid=OR:wt.doc.WTDocument:249999',
        targetRef: 'OR:wt.doc.WTDocument:249999',
        numberRaw: 'SYNTHETIC-EFR',
        nativeRole: 'RELATED',
        locator: table.panelLocator + ' a.synthetic',
        nativeColumnLabel: 'EFR Document Number',
        nativeColumnToken: 'numberDisPlay',
      });
    }, true);
    const proof = efRequestProof(env),
      record = env.package.records[0];
    proof.targetOccurrences = completeOwnedTargetOccurrences(proof);
    env.package.edges = [
      {
        edgeId: '',
        fromSourceRecordId: record.sourceRecordId,
        toSourceRecordId: 'OR:wt.doc.WTDocument:249999',
        fromSnapshotId: '',
        toSnapshotId: null,
        nativeRelationId: null,
        relationKind: 'synthetic-ef-grid-3',
        evidenceLocator: '#infoPage_myTab_object_EFRDocumentTable a.synthetic',
        observedAt: record.observedAt,
        confidence: 'observed_unresolved',
      },
    ];
    resealCurrent(env);
    const prepared = validate(env),
      native = adaptTdmsDailySource(env).output.nativePackage;
    expect(prepared.envelope).toEqual(env);
    expect(proof.targetOccurrences[0].relationshipRole).toBe('UNKNOWN');
    expect(proof.targetOccurrences[0].direction).toBe('UNKNOWN');
    expect(native.relations[0].authority).toBe('CANDIDATE_ONLY');
    expect(native.relations[0].completionEffect).toBe('UNSPECIFIED');
  });

  it.each([
    'changed',
    'missing',
    'unread',
    'codepoints',
    'source-locator',
    'section-label',
    'section-panel',
    'section-state',
    'source-declared',
    'control',
    'link',
  ])('rejects AD Modified %s in both source-bound reads', (change) => {
    const env = syntheticCompleteEnvelope('AD');
    for (const r of proofOfCurrent(env).reads) {
      const fields = r.fields.filter(
          (f: any) => f.value.actualLabel === 'Last Modified:',
        ),
        f = fields[1],
        section = r.sections.find((s: any) => s.sectionId === f.sectionId);
      if (change === 'changed') {
        f.value.rawValue += '1';
        f.value.observedTotalCodepoints++;
      }
      if (change === 'missing') r.fields.splice(r.fields.indexOf(f), 1);
      if (change === 'unread') {
        f.value.state = 'NOT_READ';
        f.value.rawValue = null;
        f.value.observedTotalCodepoints = 0;
      }
      if (change === 'codepoints') f.value.observedTotalCodepoints++;
      if (change === 'source-locator') {
        f.value.locator = '#other Modified';
        f.fieldId = f.value.locator;
      }
      if (change === 'section-label') section.label = 'General';
      if (change === 'section-panel') section.panelLocator = '#other';
      if (change === 'section-state') section.state = 'NOT_READ';
      if (change === 'source-declared') section.sourceDeclared = false;
      if (change === 'control') f.nativeControl.readOnly = true;
      if (change === 'link')
        f.links.push({
          rawHref: '/infoPage?oid=OR:wt.doc.WTDocument:249999',
          targetRef: 'OR:wt.doc.WTDocument:249999',
          nativeRole: 'RELATED',
          numberRaw: 'SYNTHETIC',
          locator: f.fieldId + ' a.synthetic',
        });
      efRequestStructuralRosters(r);
    }
    const r = proofOfCurrent(env).reads[1];
    env.package.records[0].content.completeOwnedFields = copyComplete(r.fields);
    sealComplete(env);
    expect(() => validate(env)).toThrow();
  });

  it('rejects changed AD mirrors with the actual Source pure function error and preserves valid pair', () => {
    const env = syntheticCompleteEnvelope('AD');
    expect(validate(env).envelope).toEqual(env);
    const fields = copyComplete(golden.adFields);
    fields[1].value.rawValue = '2026-10-13 09:01';
    expect(() =>
      validateReviewedAdModifiedMirrors({
        scopeId: 'AD',
        owner: golden.adOwner,
        fields,
        sections: golden.adSections,
      }),
    ).toThrow(golden.results.adChanged);
    expect(
      validateReviewedAdModifiedMirrors({
        scopeId: 'SB',
        owner: golden.adOwner,
        fields,
        sections: golden.adSections,
      }),
    ).toBe(false);
  });

  it('preserves the optional raw field through the existing memory import/readback and ten-key receipt', async () => {
    const env = syntheticFiniteRawControl([raw]),
      adapted = adaptTdmsDailySource(env),
      claims = copyComplete(adapted.memberClaims),
      repository = new MemoryTdmsRepository();
    const authority = new HostDecisionTdmsSourceAuthorization(
      async () => [
        { scope: nativeScope, permissionRevision: 'synthetic-finite-1' },
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
    const artifacts = { acquire: jest.fn() },
      service = new TdmsSourceService(repository, authority, artifacts, {
        assertRead: jest.fn(),
      });
    const receipt = await service.importDailyMetadata(actor(), env);
    expect(Object.keys(receipt)).toHaveLength(10);
    expect(
      (await service.readDailyMetadataImport(actor(), env.requestId)).package,
    ).toEqual(env.package);
    expect(repository.state.captures[0].receipt.executionVerified).toBe(false);
    expect(artifacts.acquire).not.toHaveBeenCalled();
  });
});
