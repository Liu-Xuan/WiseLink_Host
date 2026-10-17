import { copyComplete } from './tdms-complete-owned.fixture';
import { aeoProof, syntheticAeoEnvelope } from './tdms-aeo-capacity.fixture';
import { syntheticEfRelated } from './tdms-source-t1-ef.fixture';
import { proofOfCurrent } from './tdms-current-contract.fixture';
import { resealT1, t1StructuralRosters } from './tdms-source-t1.fixture';
import {
  REVIEWED_AEO_RELATED_STATUS_NATIVE_VIEW_MODEL as aeoModel,
  aeoImplicitStatusOwnerBinding,
} from '../../../server/modules/tdms-source/tdms-reviewed-aeo-related-status-native-view';
import {
  REVIEWED_EFREQUEST_RELATED_QUERY_MODEL as efQueryModel,
  REVIEWED_EFREQUEST_RELATED_MODEL as efRelatedModel,
} from '../../../server/modules/tdms-source/tdms-reviewed-complete-source-types';

// Current-notice inputs are entirely fabricated; no native files or bodies.
const node = (id, tag = 'DIV', rawClassName = '', visible = true) => ({
  id,
  tag,
  rawClassName,
  visible,
});
export function syntheticAeoNativeView() {
  const env = syntheticAeoEnvelope(2),
    p = aeoProof(env),
    m = aeoModel;
  for (const read of p.reads) {
    read.owner.scopeEvidence.rawTypeField = 'EO整体';
    const template = read.fields[0],
      locator = '#syntheticDetails #dataStorePrimary_Attributes td.own-subtype';
    read.fields.push({
      ...copyComplete(template),
      fieldId: locator,
      tabId: 'infoPageinfoPanelID__syntheticDetails',
      sectionId: 'infoPageinfoPanelID__syntheticDetails::Primary_Attributes',
      value: {
        state: 'VALUE',
        actualLabel: '指令类别:',
        rawValue: 'AEO',
        locator,
        observedTotalCodepoints: 3,
      },
      links: [],
    });
    const table = read.relationTables[0];
    // The exact prior execution literal remains a source assertion. It does
    // not create executionDeclaration, a current outcome or formal acceptance.
    const prior = table.rows[0].cells.find(
      (c) => c.actualLabel === 'Execute Time',
    );
    prior.rawValue = 'SYNTHETIC PRIOR SOURCE ASSERTION';
    prior.state = 'VALUE';
    prior.observedTotalCodepoints = prior.rawValue.length;
    const windows = table.windows.map((w) => {
      const position = Object.fromEntries(
        [
          'reportedTotal',
          'pageRaw',
          'scroll',
          'nextControl',
          'rowOccurrenceIds',
          'globalIndices',
          'treePending',
        ].map((key) => [key, copyComplete(w[key])]),
      );
      const frame = {
        ownerBinding: aeoImplicitStatusOwnerBinding(read.owner),
        activeTabId: m.tabId,
        panelId: m.panelLocator.slice(1),
        gridId: m.gridId,
        toolbarRosters: syntheticToolbarRosters(m),
        hiddenParameterRoster: [],
        query: {
          id: 'relatedStatusLinkTable.searchInListTextBox',
          tag: 'INPUT',
          type: 'text',
          name: 'relatedStatusLinkTable.searchInListTextBox',
          rawClassName: 'x-form-text x-form-field x-form-empty-field',
          rawValue: 'Search in table',
          ariaLabel: null,
          placeholder: null,
          disabled: false,
          visible: true,
          normalization: 'EMPTY_NATIVE_TEXT',
        },
        utilities: {
          headerLoadingText: 'Loading...',
          footerLoadingText: 'Loading...',
          searchWheelRawText: '',
        },
        columns: copyComplete(m.columns),
        position,
        observedAt: read.observedAt,
      };
      return {
        windowOrdinal: w.ordinal,
        before: frame,
        after: copyComplete(frame),
        settledReads: 2,
      };
    });
    table.sourceViewEvidence = {
      schemaVersion: m.schemaVersion,
      kind: m.kind,
      state: 'VALUE',
      modelRevision: m.modelRevision,
      meaning: m.meaning,
      semanticAuthority: copyComplete(m.semanticAuthority),
      backendFiltersState: 'UNKNOWN',
      evidenceLocator: m.evidenceLocator,
      ownerSourceRecordId: read.owner.sourceRecordId,
      nativeTypeId: read.owner.nativeTypeId,
      rawHeaderType: read.owner.rawHeaderType,
      engineeringSubtype: 'AEO',
      ownerTechnicalVersion: copyComplete(read.owner.sourceVersion),
      ownerBusinessVersion: copyComplete(read.owner.businessVersion),
      ownerModifiedRaw: read.owner.sourceModifiedRaw,
      tabId: m.tabId,
      panelLocator: m.panelLocator,
      gridId: m.gridId,
      windows,
      observedAt: read.observedAt,
    };
    t1StructuralRosters(read);
  }
  return resealT1(env);
}
export function syntheticEfRelatedQueries() {
  const env = syntheticEfRelated(),
    p = proofOfCurrent(env);
  for (const read of p.reads) {
    for (const table of read.relationTables.filter(
      (t) => t.relatedSurfaceEvidence,
    )) {
      const m = efQueryModel.grids.find((g) => g.gridId === table.gridId),
        raw = efRelatedModel.grids.find((g) => g.gridId === table.gridId);
      const s = table.relatedSurfaceEvidence.after;
      s.controls = [
        {
          node: node(
            m.searchId,
            'INPUT',
            'x-form-text x-form-field x-form-empty-field',
          ),
          type: 'text',
          rawValue: m.searchPlaceholder,
          valueEvidenceState: 'VALUE',
          disabled: false,
        },
      ];
      s.counts = [
        { node: node(null, 'SPAN', 'tableCount'), rawText: '(1 object)' },
        ...(m.selectedCountRequired
          ? [
              {
                node: node(null, 'SPAN', 'tableCount'),
                rawText: '(0 objects selected)',
              },
            ]
          : []),
      ];
      s.loading.utilitySlots = raw.utilityIds.map((id) => ({
        node: node(id, 'DIV', 'xtb-text'),
        childElementCount: 0,
        rawText: '',
      }));
      s.scrollers = [
        {
          node: node('synthetic-scroller'),
          top: 0,
          height: 100,
          viewport: 100,
        },
      ];
      table.relatedSurfaceEvidence.before = copyComplete(s);
      table.windows[0].globalIndices = [0];
      table.windows[0].scroll = {
        top: 0,
        height: 100,
        viewport: 100,
        atTop: true,
        atBottom: true,
      };
      const view = {
        state: 'VALUE',
        input: {
          node: node(m.viewId, 'INPUT', 'x-form-text'),
          type: 'text',
          name: m.viewId,
          rawValue: m.viewName,
          disabled: false,
          rawAttributes: [],
        },
        wrapper: node(
          'synthetic-wrap',
          'DIV',
          'x-form-field-wrap x-form-field-trigger-wrap',
        ),
        arrow: node(null, 'IMG', 'x-form-arrow-trigger x-form-trigger'),
        popup: {
          node: node('synthetic-popup', 'DIV', 'x-combo-list'),
          rawAttributes: [],
        },
        header: {
          node: node(null, 'DIV', 'x-combo-list-hd'),
          rawText: '- Pick a View -',
        },
        options: m.options.map((value) => ({
          node: node(
            null,
            'DIV',
            'x-combo-list-item' +
              (value === m.viewName ? ' x-combo-selected' : ''),
          ),
          rawText: value,
          rawAttributes: [],
        })),
        inputBefore: m.viewName,
        inputAfter: m.viewName,
        serializedValue: { state: 'NOT_EXPOSED', rawValue: null },
        backendCriteria: { state: 'NOT_READ', rawValue: null },
        sequence: ['ARROW_OPENED', 'CHOICES_READ', 'ACTIVE_TAB_CLOSED'],
      };
      const selectedOnly = {
        state: 'NOT_APPLICABLE',
        control: null,
        button: null,
        popup: null,
        item: null,
        parentLi: null,
        checkItemIds: [],
        sequence: [],
        nativeChecked: null,
        ariaChecked: null,
      };
      if (m.selectedOnlyRequired)
        Object.assign(selectedOnly, {
          state: 'VALUE',
          control: node(m.selectedOnlyControlId, 'TABLE'),
          button: node(null, 'BUTTON', 'optionsButton'),
          popup: node('synthetic-menu', 'DIV', 'x-menu'),
          item: {
            ...node(m.selectedOnlyItemId, 'A', 'x-menu-item x-menu-check-item'),
            rawText: 'View Selected Objects Only',
          },
          parentLi: node(
            'x-menu-el-' + m.selectedOnlyItemId,
            'LI',
            'x-menu-list-item',
          ),
          checkItemIds: [m.selectedOnlyItemId],
          sequence: ['BUTTON_OPENED', 'ITEM_READ', 'BUTTON_CLOSED'],
        });
      const frame = {
        view,
        selectedOnly,
        additionalControls: [],
        panelUnreviewedNodes: [],
        surface: copyComplete(s),
      };
      table.relatedQueryEvidence = {
        schemaVersion: efQueryModel.schemaVersion,
        modelRevision: efQueryModel.modelRevision,
        scopeId: efQueryModel.scopeId,
        ownerSourceRecordId: read.owner.sourceRecordId,
        ownerSourceVersion: copyComplete(read.owner.sourceVersion),
        ownerSourceModifiedRaw: read.owner.sourceModifiedRaw,
        nativeTypeId: read.owner.nativeTypeId,
        tabId: m.tabId,
        panelLocator: m.panelLocator,
        gridId: m.gridId,
        queryScope: efQueryModel.queryScope,
        contractScopeCoverage: { state: 'UNKNOWN', proof: null },
        windows: [
          {
            windowOrdinal: 0,
            before: frame,
            after: copyComplete(frame),
            settledReads: 2,
          },
        ],
      };
    }
  }
  return resealT1(env);
}

function syntheticToolbarRosters(model) {
  let counter = 10000;
  const rosters = copyComplete(model.toolbarRosters);
  for (const roster of rosters) {
    for (const item of [roster.root, ...roster.nodes]) {
      for (const [key, value] of Object.entries(item.attributes)) {
        if (value === '%EXT_GEN%') item.attributes[key] = 'ext-gen' + counter++;
        if (value === '%EXT_COMP%')
          item.attributes[key] = 'ext-comp-' + counter++;
      }
    }
    roster.locator =
      model.evidenceLocator + ' [id="' + roster.root.attributes.id + '"]';
  }
  return rosters;
}
