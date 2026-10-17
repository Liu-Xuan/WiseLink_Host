import { prepareTdmsDailySourceImport } from '../../../server/modules/tdms-source/tdms-daily-metadata-contract';
import { adaptTdmsDailySource } from '../../../server/modules/tdms-source/tdms-daily-source-adapter';
import {
  completeContentIdentityProjection,
  completeOwnedObservedEdges,
} from '../../../server/modules/tdms-source/tdms-complete-owned-source.validation';
import { REVIEWED_SB_DOCUMENT_STRUCTURE_MODEL } from '../../../server/modules/tdms-source/tdms-reviewed-sb-document-structure-native-model';
import { REVIEWED_SB_NATIVE_TREE_MODEL } from '../../../server/modules/tdms-source/tdms-reviewed-sb-native-tree';
import { REVIEWED_SB_ATTACHMENT_ALIAS_MODEL } from '../../../server/modules/tdms-source/tdms-reviewed-sb-attachment-alias-purpose';
import { REVIEWED_SB_FIELDS_ALIAS_MODEL } from '../../../server/modules/tdms-source/tdms-reviewed-sb-fields-alias-purpose';
import { REVIEWED_SB_HISTORY_MODEL } from '../../../server/modules/tdms-source/tdms-reviewed-sb-history-purpose';
import { REVIEWED_SB_MANAGEMENT_MODEL } from '../../../server/modules/tdms-source/tdms-reviewed-sb-management-purpose';
import { REVIEWED_SB_NOTEBOOK_MODEL } from '../../../server/modules/tdms-source/tdms-reviewed-sb-notebook-purpose';
import { TdmsSourceService } from '../../../server/modules/tdms-source/tdms-source.service';
import { HostDecisionTdmsSourceAuthorization } from '../../../server/modules/tdms-source/tdms-source.authorization';
import { MemoryTdmsRepository, nativeScope } from './tdms-memory-double';
import { actor } from './tdms-fixtures';
import {
  syntheticSbDetails,
  syntheticSbPanels,
  sbProof,
  withSbStructureEvidence,
  sbCopy,
  sealSb,
  sbDetail,
  structuralRoster,
  syntheticSbStructureOnly,
} from './tdms-reviewed-sb-0-2-73.fixture';

const validate = prepareTdmsDailySourceImport;
const editDetails = (
  fn: (read: any, blank: any) => void,
  state = 'Estimated',
) => {
  const env = syntheticSbDetails(state);
  for (const read of sbProof(env).reads)
    fn(
      read,
      read.fields.find((f: any) => f.value.actualLabel === ''),
    );
  return sealSb(env);
};
const editPanels = (fn: (read: any) => void) => {
  const env = withSbStructureEvidence();
  for (const read of sbProof(env).reads) fn(read);
  return sealSb(env);
};

describe('Source 0.2.73 SB proofs through the existing Host consumer (synthetic)', () => {
  it('accepts the exact native anonymous blank through the real adapter without promoting an opinion', () => {
    const env = syntheticSbDetails();
    expect(prepareTdmsDailySourceImport(env).envelope).toEqual(env);
    const native = adaptTdmsDailySource(env).output.nativePackage.records[0];
    expect(native.content.completeOwnedFields).toEqual(
      env.package.records[0].content.completeOwnedFields,
    );
    expect(native.coverage.status).toBe('PARTIAL');
    expect(native.coverage.gaps).toContain('COMPLETION_CERTIFICATE_NOT_ISSUED');
  });
  it('consumes all exact SB panel models on the same real wire while the Structure and row content stay incomplete', () => {
    const env = withSbStructureEvidence();
    expect(prepareTdmsDailySourceImport(env).envelope).toEqual(env);
    const native = adaptTdmsDailySource(env).output.nativePackage.records[0];
    expect((native.rawFields.completeOwnedSource as any).reads).toEqual(
      sbProof(env).reads,
    );
    expect(native.coverage.gaps).toEqual(
      expect.arrayContaining([
        'SB_NATIVE_TREE_ROW_CONTENT_UNREAD',
        'OWN_CONTENT_UNREAD',
        'COMPLETION_CERTIFICATE_NOT_ISSUED',
      ]),
    );
    expect(completeOwnedObservedEdges(env.package.records[0])).toEqual([]);
    expect(sbProof(env).targetOccurrences[0]).toMatchObject({
      relationshipRole: 'OUT_OF_SCOPE_REFERENCE',
      modelRoleOrigin: 'SOURCE_PRESENTED_SB_NATIVE_NUMBER_OCCURRENCE',
    });
  });

  it.each(['Approved', '已批准', 'Estimated', 'Estimating'])(
    'accepts exact empty SB metadata at %s without opinion authority',
    (state) => {
      const env = syntheticSbDetails(state);
      expect(validate(env).envelope).toEqual(env);
      expect(
        adaptTdmsDailySource(env).output.nativePackage.records[0].content,
      ).toEqual(env.package.records[0].content);
    },
  );

  it.each(['SB', 'SIL', 'SB-IN', 'SL', 'MT'])(
    'binds the reviewed blank to the exact %s subtype',
    (scopeId) => {
      const env = syntheticSbDetails();
      const visit = (value: any): void => {
        if (!value || typeof value !== 'object') return;
        for (const [key, entry] of Object.entries(value)) {
          if (['scopeId', 'businessType'].includes(key) && entry === 'SB')
            value[key] = scopeId;
          else visit(entry);
        }
      };
      visit(env);
      sealSb(env);
      expect(validate(env).envelope).toEqual(env);
      expect(
        adaptTdmsDailySource(env).output.nativePackage.records[0].recordKind,
      ).toBe('MANUFACTURER_FILE');
    },
  );

  it.each([
    'missing',
    'nonempty',
    'nonempty-no-proof',
    'whitespace',
    'caption',
    'renderer-caption',
    'renderer-value',
    'renderer-link',
    'renderer-editor',
    'unsettled',
    'owner',
    'version',
    'modified',
    'state',
    'source-context',
    'normal-owner',
    'normal-origin',
    'normal-foreign-hash',
    'normal-credential-hash',
    'normal-time',
    'extra-key',
    'canonical-field',
    'alias-use',
  ])('rejects SB blank %s with the stable proof error', (change) => {
    const env = editDetails((read, blank) => {
      const p = blank.strictBlankEvidence;
      if (change === 'missing') delete blank.strictBlankEvidence;
      if (change === 'nonempty' || change === 'nonempty-no-proof') {
        blank.value.state = 'VALUE';
        blank.value.rawValue = 'unreviewed anonymous body';
        blank.value.observedTotalCodepoints = [...blank.value.rawValue].length;
        if (change === 'nonempty-no-proof') delete blank.strictBlankEvidence;
      }
      if (change === 'whitespace') {
        blank.value.rawValue = ' ';
        blank.value.observedTotalCodepoints = 1;
      }
      if (change === 'caption') blank.rawCaptionText = ' ';
      if (change === 'renderer-caption') p.before.rawCaptionText = ' ';
      if (change === 'renderer-value') p.before.rawText = 'not blank';
      if (change === 'renderer-link') p.before.linkCount = 1;
      if (change === 'renderer-editor') p.before.editorCount = 1;
      if (change === 'unsettled') p.settledReads = 1;
      if (change === 'owner')
        p.ownerSourceRecordId = 'OR:wt.doc.WTDocument:99999';
      if (change === 'version') p.ownerSourceVersion.rawRevision = 'B';
      if (change === 'modified') p.ownerSourceModifiedRaw += '-changed';
      if (change === 'state') p.ownStateRaw = 'Approved';
      if (change === 'source-context')
        p.sourceContext.principalDisplayName = 'Different principal';
      if (change === 'normal-owner') {
        p.normalBinding.url += '0';
        read.domDocumentIdentity.url = p.normalBinding.url;
      }
      if (change === 'normal-origin') {
        p.normalBinding.url = p.normalBinding.url.replace(
          'tdms.airchina.com',
          'unreviewed.invalid',
        );
        read.domDocumentIdentity.url = p.normalBinding.url;
      }
      if (change === 'normal-time') p.normalBinding.timeOrigin += 1;
      if (
        change === 'normal-foreign-hash' ||
        change === 'normal-credential-hash'
      ) {
        const inner =
          change === 'normal-foreign-hash'
            ? 'https://unreviewed.invalid'
            : 'http://synthetic:synthetic@tdms.airchina.com';
        p.normalBinding.url =
          read.sourceContext.sourceInstanceOrigin +
          '/Windchill/app/#ptc1' +
          inner +
          '/tcomp/infoPage?oid=' +
          read.owner.sourceRecordId;
        read.domDocumentIdentity.url = p.normalBinding.url;
      }
      if (change === 'extra-key') p.optional = true;
      if (change === 'canonical-field') p.canonicalFieldId += '-different';
      if (change === 'alias-use') p.use = 'ALIAS';
    });
    expect(() => validate(env)).toThrow(
      'TDMS_COMPLETE_SB_ANONYMOUS_STRICT_BLANK_UNPROVEN',
    );
  });

  it('keeps an unobserved anonymous field unread and retains its coverage gap', () => {
    const env = editDetails((read, field) => {
      delete field.strictBlankEvidence;
      field.value = {
        ...field.value,
        state: 'NOT_READ',
        rawValue: null,
        observedTotalCodepoints: 0,
      };
      read.tabs[0].state = 'NOT_READ';
      read.rosterEvidence.unknownRequiredSurfaces.push(field.fieldId);
    }, 'Estimating');
    env.package.records[0].coverage.gaps.push('OWN_CONTENT_UNREAD');
    env.package.coverage = sbCopy(env.package.records[0].coverage);
    sealSb(env);
    expect(validate(env).envelope).toEqual(env);
    expect(
      adaptTdmsDailySource(env).output.nativePackage.records[0].coverage.gaps,
    ).toContain('OWN_CONTENT_UNREAD');
  });

  it.each(['Approved', '已批准', 'Estimated', 'Estimating'])(
    'does not qualify a manufacturer opinion body at %s',
    (state) => {
      const env = editDetails((read) => {
        read.tabs.push({
          tabId: 'unreviewed-opinion-tab',
          label: 'Unreviewed',
          panelLocator: '#synthetic-opinion',
          required: true,
          sourceDeclared: true,
          reasonCode: null,
          state: 'VALUE',
        });
        read.sections.push({
          sectionId: 'unreviewed-opinion-section',
          tabId: 'unreviewed-opinion-tab',
          label: 'Own',
          panelLocator: '#synthetic-opinion',
          sourceDeclared: true,
          state: 'VALUE',
        });
        read.fields.push({
          fieldId: '#synthetic-opinion field',
          tabId: 'unreviewed-opinion-tab',
          sectionId: 'unreviewed-opinion-section',
          labelOrigin: 'NATIVE_SOURCE_DECLARED',
          nativeControl: { tag: 'TD', readOnly: null, disabled: null },
          value: {
            state: 'VALUE',
            actualLabel: '评估意见:',
            rawValue: 'unqualified body',
            observedTotalCodepoints: 16,
            locator: '#synthetic-opinion field',
          },
          links: [],
        });
        read.rosterEvidence.tabIds.push('unreviewed-opinion-tab');
        read.rosterEvidence.structuralRosters.push(
          structuralRoster(read, 'unreviewed-opinion-tab'),
        );
      }, state);
      expect(() => validate(env)).toThrow(
        state === 'Estimating'
          ? 'TDMS_ESTIMATING_STATE_ONLY_REQUIRED'
          : 'TDMS_OPINION_STATE_NOT_ELIGIBLE',
      );
    },
  );

  it.each(['field-missing', 'field-order', 'section-label', 'modified-mirror'])(
    'keeps the exact Details roster and modified mirrors (%s)',
    (change) => {
      const env = editDetails((read) => {
        if (change === 'field-missing') read.fields.splice(0, 1);
        if (change === 'field-order')
          [read.fields[0], read.fields[1]] = [read.fields[1], read.fields[0]];
        if (change === 'section-label') read.sections[0].label = 'Other';
        if (change === 'modified-mirror') {
          const value = read.fields.find(
            (f: any) => f.value.actualLabel === 'Last Modified:',
          ).value;
          value.rawValue += '-changed';
          value.observedTotalCodepoints = [...value.rawValue].length;
        }
        read.rosterEvidence.structuralRosters = [
          structuralRoster(read, sbDetail.tabId),
        ];
      });
      expect(() => validate(env)).toThrow(
        change === 'modified-mirror'
          ? 'TDMS_COMPLETE_OWN_MODIFIED_MIRROR_CHANGED'
          : 'TDMS_ANONYMOUS_OWN_RAW_',
      );
    },
  );

  it.each(['schema', 'order', 'column', 'unknown-control', 'unsettled'])(
    'rejects native layout %s',
    (change) => {
      const env = editPanels((read) => {
        const e = read.sbNativeLayoutEvidence;
        if (change === 'schema') e.modelRevision += '-caller';
        if (change === 'order') e.panels.reverse();
        if (change === 'column')
          e.panels[2].before.grids[0].columns[0].nativeColumnToken =
            'description';
        if (change === 'unknown-control')
          e.panels[0].before.unknownControlCount = 1;
        if (change === 'unsettled') e.panels[0].settledReads = 1;
      });
      expect(() => validate(env)).toThrow(
        'TDMS_COMPLETE_SB_NATIVE_LAYOUT_INVALID',
      );
    },
  );

  const purposes: Array<[string, any, string]> = [
    [
      'notebook',
      REVIEWED_SB_NOTEBOOK_MODEL,
      'TDMS_COMPLETE_SB_NOTEBOOK_PURPOSE_INVALID',
    ],
    [
      'attachment',
      REVIEWED_SB_ATTACHMENT_ALIAS_MODEL,
      'TDMS_COMPLETE_SB_ATTACHMENT_ALIAS_PURPOSE_INVALID',
    ],
    [
      'fields',
      REVIEWED_SB_FIELDS_ALIAS_MODEL,
      'TDMS_COMPLETE_SB_FIELDS_ALIAS_PURPOSE_INVALID',
    ],
    [
      'history',
      REVIEWED_SB_HISTORY_MODEL,
      'TDMS_COMPLETE_SB_HISTORY_PURPOSE_INVALID',
    ],
    [
      'management',
      REVIEWED_SB_MANAGEMENT_MODEL,
      'TDMS_COMPLETE_SB_MANAGEMENT_PURPOSE_INVALID',
    ],
  ];
  it.each(
    purposes.flatMap(([name, model, error]) =>
      [
        'owner',
        'source-version',
        'body',
        'optional',
        'column',
        'unknown-surface',
      ].map((change) => [name, change, model, error] as const),
    ),
  )('rejects %s purpose %s', (_name, change, model, error) => {
    const env = editPanels((read) => {
      const t = read.tabs.find(
          (tab: any) => tab.tabId === model.panels[0].tabId,
        ),
        p = t.purposeEvidence;
      if (change === 'owner') p.ownerSourceRecordId += '0';
      if (change === 'source-version') p.sourceVersion.rawRevision = 'B';
      if (change === 'body') p.bodyState = 'VALUE';
      if (change === 'optional') t.required = !t.required;
      if (change === 'column')
        p.before.grids[0].columns[0].actualLabel = 'unreviewed';
      if (change === 'unknown-surface') p.before.unknownSurfaceCount = 1;
    });
    expect(() => validate(env)).toThrow(error);
  });

  it.each([
    'missing-alias-blank-proof',
    'alias-nonempty',
    'alias-canonical-id',
    'attachment-data-changed',
    'history-body',
    'notebook-body',
  ])('rejects alias/reference promotion %s', (change) => {
    const env = editPanels((read) => {
      const e = (model: any) =>
        read.tabs.find((t: any) => t.tabId === model.panels[0].tabId)
          .purposeEvidence;
      const fields = e(REVIEWED_SB_FIELDS_ALIAS_MODEL),
        blank = fields.before.aliasFields.find((f: any) => f.label === '');
      if (change === 'missing-alias-blank-proof')
        delete blank.strictBlankEvidence;
      if (change === 'alias-nonempty') blank.rawValue = 'unreviewed body';
      if (change === 'alias-canonical-id') blank.canonicalFieldId += '-other';
      if (change === 'attachment-data-changed')
        e(REVIEWED_SB_ATTACHMENT_ALIAS_MODEL).aliasTable.rawHeaders[0] =
          'Other';
      if (change === 'history-body')
        e(REVIEWED_SB_HISTORY_MODEL).before.embeddedReferences[0].bodyState =
          'VALUE';
      if (change === 'notebook-body')
        e(REVIEWED_SB_NOTEBOOK_MODEL).before.embeddedReferences[0].bodyState =
          'VALUE';
    });
    expect(() => validate(env)).toThrow('TDMS_COMPLETE_SB_');
  });

  it.each([
    'owner',
    'normal-document',
    'inner-document',
    'modified',
    'query-promotion',
    'terminal-promotion',
    'descriptive-body',
  ])('rejects Structure %s', (change) => {
    const env = editPanels((read) => {
      const t = read.tabs.find(
          (tab: any) =>
            tab.tabId === REVIEWED_SB_DOCUMENT_STRUCTURE_MODEL.tabId,
        ),
        p = t.purposeEvidence;
      if (change === 'owner') p.ownerSourceRecordId += '0';
      if (change === 'normal-document') p.normalBinding.timeOrigin++;
      if (change === 'inner-document')
        p.ownerContinuity.finalInnerDocument.timeOrigin++;
      if (change === 'modified')
        p.before.attributes.before.fields.at(-1).rawValue += '-changed';
      if (change === 'query-promotion')
        p.before.query.nativeQueryUi.state = 'VALUE';
      if (change === 'terminal-promotion') {
        t.state = 'VALUE';
        t.reasonCode = null;
      }
      if (change === 'descriptive-body') {
        const table = read.relationTables.find(
          (x: any) => x.tableId === p.tableId,
        );
        void table;
        p.before.uses.rows.push({
          cells: REVIEWED_SB_DOCUMENT_STRUCTURE_MODEL.usesColumns.map(
            (c: any) => ({
              ...c,
              state: 'VALUE',
              rawValue: 'unqualified',
              observedTotalCodepoints: 11,
            }),
          ),
        });
      }
    });
    expect(() => validate(env)).toThrow(
      'TDMS_COMPLETE_SB_STRUCTURE_NATIVE_INVALID',
    );
  });

  it('cannot mark missing Structure proof as read', () => {
    const env = syntheticSbPanels();
    for (const read of sbProof(env).reads) {
      const tab = read.tabs.find(
        (t: any) => t.tabId === REVIEWED_SB_DOCUMENT_STRUCTURE_MODEL.tabId,
      );
      tab.state = 'VALUE';
      tab.reasonCode = null;
    }
    sealSb(env);
    expect(() => validate(env)).toThrow(
      'TDMS_REVIEWED_COMPLETE_TAB_PURPOSE_INVALID',
    );
  });

  it('binds a partial Structure-only observation to the actual Source origin', () => {
    const env = syntheticSbStructureOnly();
    expect(
      adaptTdmsDailySource(env).output.nativePackage.records[0].coverage.status,
    ).toBe('PARTIAL');
    const changeOrigin = (v: any): void => {
      if (!v || typeof v !== 'object') return;
      for (const [key, value] of Object.entries(v)) {
        if (
          ['url', 'rawSrc', 'innerURL'].includes(key) &&
          typeof value === 'string'
        )
          v[key] = value.replace('tdms.airchina.com', 'unreviewed.invalid');
        else changeOrigin(value);
      }
    };
    changeOrigin(env);
    sealSb(env);
    expect(() => validate(env)).toThrow(
      'TDMS_COMPLETE_SB_STRUCTURE_NATIVE_INVALID',
    );
  });

  it.each(['foreign', 'credential'])(
    'rejects a Structure route with %s hash authority',
    (kind) => {
      const env = syntheticSbStructureOnly();
      for (const read of sbProof(env).reads) {
        const inner =
          kind === 'foreign'
            ? 'https://unreviewed.invalid'
            : 'http://synthetic:synthetic@tdms.airchina.com';
        const url =
          read.sourceContext.sourceInstanceOrigin +
          '/Windchill/app/#ptc1' +
          inner +
          '/tcomp/infoPage?oid=' +
          read.owner.sourceRecordId;
        read.domDocumentIdentity.url = url;
        const proof = read.tabs[0].purposeEvidence;
        proof.normalBinding.url = url;
        read.relationTables[0].relatedSurfaceEvidence.normalBinding.url = url;
      }
      sealSb(env);
      expect(() => validate(env)).toThrow(
        'TDMS_COMPLETE_SB_STRUCTURE_NATIVE_INVALID',
      );
    },
  );

  it.each([null, {}, [null]])(
    'rejects malformed SB tab data through the existing typed boundary (%j)',
    (tabs) => {
      const env = syntheticSbStructureOnly();
      for (const read of sbProof(env).reads) read.tabs = tabs;
      try {
        validate(env);
        throw new Error('EXPECTED_REJECTION');
      } catch (error) {
        expect(error).toMatchObject({
          statusCode: 400,
          code: expect.stringMatching(/^TDMS_COMPLETE_OWN_/u),
        });
      }
    },
  );

  it.each([
    'owner',
    'version',
    'query',
    'window-gap',
    'metadata-target',
    'unread-end',
    'marker',
    'no-evidence',
  ])('rejects native tree %s', (change) => {
    const env = editPanels((read) => {
      const t = read.relationTables.find(
          (table: any) => table.gridId === REVIEWED_SB_NATIVE_TREE_MODEL.gridId,
        ),
        p = t.nativeTreeEvidence;
      if (change === 'owner') p.ownerSourceRecordId += '0';
      if (change === 'version') p.ownerSourceVersion.rawIteration = '2';
      if (change === 'query')
        p.windows[0].query.explicitMarkers.push({ filter: 'selected' });
      if (change === 'window-gap') t.windows[0].scroll.atBottom = false;
      if (change === 'metadata-target')
        p.windows[0].rowMetadata[0].columns[1].nativeRefs[0].targetRef += '0';
      if (change === 'unread-end') t.terminal.allTreeNodesExpanded = false;
      if (change === 'marker')
        p.windows[0].rowShapes[0].elbows[0].class = 'unreviewed-leaf';
      if (change === 'no-evidence') delete t.nativeTreeEvidence;
    });
    expect(() => validate(env)).toThrow('TDMS_COMPLETE_');
  });

  it('normalizes only the exact validated blank document time while preserving unknown raw identifiers', () => {
    const a = syntheticSbDetails(),
      b = sbCopy(a);
    for (const read of sbProof(b).reads) {
      read.domDocumentIdentity.timeOrigin++;
      read.fields.find((f: any) => f.strictBlankEvidence).strictBlankEvidence
        .normalBinding.timeOrigin++;
    }
    sealSb(b);
    expect(validate(b).envelope).toEqual(b);
    expect(a.package.records[0].snapshotId).toBe(
      b.package.records[0].snapshotId,
    );
    expect(a.requestId).not.toBe(b.requestId);
    expect(completeContentIdentityProjection(a.package.records[0])).toEqual(
      completeContentIdentityProjection(b.package.records[0]),
    );
    for (const read of sbProof(b).reads) {
      read.fields[0].value.rawValue = 'x-auto-opaque-business-id-73002';
      read.fields[0].value.observedTotalCodepoints = [
        ...read.fields[0].value.rawValue,
      ].length;
    }
    sealSb(b);
    expect(validate(b).envelope).toEqual(b);
    expect(a.package.records[0].snapshotId).not.toBe(
      b.package.records[0].snapshotId,
    );
  });

  it('retains all proofs through the existing memory import/readback, stable retry and ten-key receipt', async () => {
    const env = withSbStructureEvidence(),
      claims = sbCopy(adaptTdmsDailySource(env).memberClaims),
      repository = new MemoryTdmsRepository();
    const authority = new HostDecisionTdmsSourceAuthorization(
      async () => [
        { scope: nativeScope, permissionRevision: 'synthetic-sb-1' },
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
      documents = { assertRead: jest.fn() };
    const service = new TdmsSourceService(
      repository,
      authority,
      artifacts,
      documents,
    );
    const receipt = await service.importDailyMetadata(actor(), env);
    expect(Object.keys(receipt)).toHaveLength(10);
    expect(await service.importDailyMetadata(actor(), env)).toEqual(receipt);
    expect(
      (await service.readDailyMetadataImport(actor(), env.requestId)).package,
    ).toEqual(env.package);
    expect(repository.state.captures).toHaveLength(1);
    expect(repository.state.captures[0].receipt.executionVerified).toBe(false);
    expect(artifacts.acquire).not.toHaveBeenCalled();
    expect(documents.assertRead).not.toHaveBeenCalled();
  });
});
