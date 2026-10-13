import golden from '../../fixtures/tdms-source/efrequest-current-contract.synthetic.json';
import { createHash } from 'node:crypto';
import {
  copyComplete,
  sealComplete,
  syntheticCompleteEnvelope,
} from './tdms-complete-owned.fixture';

// All literals are synthetic. Golden expectations came from the two supplied
// SHA-qualified, import-free producer helpers, not the Host implementation.
export const efRequestGolden = golden;
export type EfRequestEnvelope = ReturnType<typeof syntheticCompleteEnvelope>;
export const efRequestProof = (env: EfRequestEnvelope): any =>
  env.package.records[0].rawFields.completeOwnedSource;
const digest = (v: unknown) =>
  createHash('sha256').update(JSON.stringify(v)).digest('hex');
const scalar = (
  actualLabel: string,
  locator: string,
  rawValue: string | null,
  state = 'VALUE',
) => ({
  state,
  actualLabel,
  rawValue,
  locator,
  observedTotalCodepoints: rawValue === null ? 0 : [...rawValue].length,
});

export function efRequestStructuralRosters(read: any) {
  read.rosterEvidence.structuralRosters = read.tabs
    .filter((t: any) => t.required && t.state === 'VALUE')
    .map((tab: any) => {
      const fields = read.fields.filter((f: any) => f.tabId === tab.tabId);
      const sections = read.sections.filter((s: any) => s.tabId === tab.tabId);
      const roster = {
        fieldIds: fields.map((f: any) => f.fieldId),
        sectionIds: sections.map((s: any) => s.sectionId),
        fieldLocators: fields.map((f: any) => f.value.locator),
        sectionLocators: sections.map((s: any) => s.panelLocator),
        declaredFieldCount: fields.length,
        declaredSectionCount: sections.length,
        loadingPresent: false,
        terminal: 'DOM_TREE_END',
      };
      return {
        tabId: tab.tabId,
        before: roster,
        after: copyComplete(roster),
        settledReads: 2,
      };
    });
}

export function resealEfRequest(env: EfRequestEnvelope) {
  const record = env.package.records[0];
  const proof = efRequestProof(env);
  const read = proof.reads[1];
  record.sourceVersion = copyComplete(read.owner.sourceVersion);
  record.businessVersion = copyComplete(read.owner.businessVersion);
  record.state = { rawCode: null, rawName: read.owner.stateRaw };
  record.rawFields.sourceModifiedRaw = read.owner.sourceModifiedRaw;
  record.content.completeOwnedFields = copyComplete(read.fields);
  const gaps = [
    'REQUIRED_TARGET_OWN_SOURCES_PENDING',
    'COMPLETION_CERTIFICATE_NOT_ISSUED',
  ];
  if (read.sourceContext.principalDisplayName === null)
    gaps.push('SOURCE_PRINCIPAL_UNOBSERVED');
  if (read.owner.nativeTypeId === null) gaps.push('NATIVE_TYPE_UNOBSERVED');
  if (read.owner.sourceVersion.confirmation !== 'SOURCE_DECLARED')
    gaps.push('TECHNICAL_VERSION_UNCONFIRMED');
  if (read.rosterEvidence.layoutEvidencePending)
    gaps.push('OWN_LAYOUT_REPRESENTATIVE_PENDING');
  if (
    read.rosterEvidence.unknownRequiredSurfaces.length ||
    read.rosterEvidence.unreadControls.length ||
    read.tabs.some((t: any) =>
      ['NOT_READ', 'NOT_LOADED', 'TRUNCATED', 'ACCESS_DENIED'].includes(
        t.state,
      ),
    ) ||
    read.fields.some((f: any) =>
      ['NOT_READ', 'NOT_LOADED', 'TRUNCATED', 'ACCESS_DENIED'].includes(
        f.value.state,
      ),
    )
  )
    gaps.push('OWN_CONTENT_UNREAD');
  record.coverage = { status: 'PARTIAL', gaps, readback: 'NON_ATOMIC' };
  env.package.coverage = copyComplete(record.coverage);
  return sealComplete(env);
}

export function syntheticEfRequest({
  pair = true,
  unknownCaption = false,
  references = false,
  state = 'Estimated',
}: {
  pair?: boolean;
  unknownCaption?: boolean;
  references?: boolean;
  state?: string;
} = {}) {
  const env = syntheticCompleteEnvelope('ENGINEERING_ASSESSMENT', 241001);
  const proof = efRequestProof(env);
  const read = proof.reads[1];
  const native = efRequestGolden;
  const tabId = native.contentTabIds[0];
  const panel = '#infoPage_myTab_object_docInfoDefaultDetails';
  const sourceVersion = {
    rawRevision: 'A',
    rawIteration: '1',
    confirmation: 'SOURCE_DECLARED',
  };
  proof.requestedCriteria.expectedOwner.sourceVersion =
    copyComplete(sourceVersion);
  proof.requestedCriteria.expectedOwner.sourceModifiedRaw =
    native.owner.sourceModifiedRaw;
  Object.assign(read.owner, {
    sourceVersion,
    rawHeaderIdentifier: read.owner.number + ', Synthetic assessment, A.1',
    nativeTypeEvidence: scalar(
      'Mapped own header type: ' + native.owner.rawHeaderType,
      '#infoPageIdentityDisplayType',
      native.owner.nativeTypeId,
    ),
    technicalVersionEvidence: scalar(
      'Document Header Version',
      '#infoPageIdentityObjectIdentifier',
      'A.1',
    ),
    sourceModifiedRaw: native.owner.sourceModifiedRaw,
    stateRaw: state,
  });
  read.tabs = native.contentTabIds.map((id) => ({
    tabId: id,
    label: id === tabId ? 'Synthetic Details' : 'Synthetic second content tab',
    panelLocator: id === tabId ? panel : '#synthetic-extra',
    state: id === tabId && unknownCaption ? 'NOT_READ' : 'VALUE',
    required: true,
    sourceDeclared: true,
    reasonCode:
      id === tabId && unknownCaption ? 'SOURCE_CAPTION_UNKNOWN' : null,
  }));
  read.sections = [
    ...['General', 'MoreAttributesGroup'].map((label) => ({
      sectionId: `${tabId}::${label}`,
      tabId,
      label,
      panelLocator: `${panel} ${label}`,
      state: 'VALUE',
      sourceDeclared: true,
    })),
    {
      sectionId: native.contentTabIds[1] + '::synthetic',
      tabId: native.contentTabIds[1],
      label: 'Synthetic source section',
      panelLocator: '#synthetic-extra section',
      state: 'VALUE',
      sourceDeclared: true,
    },
  ];
  const opinionLocator = panel + ' MoreAttributesGroup td.synthetic-opinion';
  read.fields = [
    ...copyComplete(native.mirrors),
    {
      fieldId: opinionLocator,
      tabId,
      sectionId: `${tabId}::MoreAttributesGroup`,
      labelOrigin: 'NATIVE_SOURCE_DECLARED',
      nativeControl: { tag: 'TD', readOnly: null, disabled: null },
      value: scalar(
        'Assessment Opinion:',
        opinionLocator,
        ['Approved', '已批准', 'Estimated'].includes(state)
          ? 'Synthetic original opinion with applicable conditions.'
          : null,
        ['Approved', '已批准', 'Estimated'].includes(state)
          ? 'VALUE'
          : 'NOT_APPLICABLE',
      ),
      links: [],
    },
    ...(unknownCaption ? [copyComplete(native.unknown)] : []),
  ];
  proof.targetOccurrences = [];
  if (references) {
    for (const [index, reference] of native.referenceModels.entries()) {
      const fieldId = `${panel} General td.synthetic-reference-${index}`;
      const locator = fieldId + ' a.synthetic';
      const rawHref = '/infoPage?oid=' + reference.ref;
      read.fields.push({
        fieldId,
        tabId,
        sectionId: `${tabId}::General`,
        labelOrigin: 'NATIVE_SOURCE_DECLARED',
        nativeControl: { tag: 'TD', readOnly: null, disabled: null },
        value: scalar(
          reference.label,
          fieldId,
          'Synthetic original link label',
        ),
        links: [
          {
            rawHref,
            targetRef: reference.ref,
            numberRaw: 'SYNTHETIC-REFERENCE-' + index,
            nativeRole: 'RELATED',
            locator,
          },
        ],
      });
      proof.targetOccurrences.push({
        origin: 'OWN_FIELD',
        tableId:
          'OWN_FIELD:' +
          createHash('sha256').update(fieldId).digest('hex').slice(0, 32),
        occurrenceId: 'OWN_FIELD:' + digest([fieldId, 0, reference.ref]),
        linkIndex: 0,
        targetRef: reference.ref,
        numberRaw: 'SYNTHETIC-REFERENCE-' + index,
        rawHref,
        ...reference.model,
        rawRole: reference.label,
        nativeLinkRole: 'RELATED',
        nativeColumnLabel: null,
        nativeColumnToken: null,
        fieldId,
        fieldActualLabel: reference.label,
        tabId,
        sectionId: `${tabId}::General`,
        rawDirection: null,
        treePath: [],
        nativeRelationId: null,
        sourceVersion: {
          rawRevision: null,
          rawIteration: null,
          confirmation: 'VERSION_UNCONFIRMED',
        },
        ownerSourceVersion: sourceVersion,
        locator,
      });
    }
  }
  read.rosterEvidence = {
    tabRosterSource: 'OWN_INFOPAGE_TAB_STRIP',
    tabIds: copyComplete(native.contentTabIds),
    structuralRosters: [],
    unreadControls: [],
    unknownRequiredSurfaces: unknownCaption
      ? [native.unknown.value.locator]
      : [],
    layoutEvidencePending: true,
    ...(pair
      ? {
          nativeTabStripIds: copyComplete(
            native.rosterEvidence.nativeTabStripIds,
          ),
          nonContentControls: copyComplete(
            native.rosterEvidence.nonContentControls,
          ),
        }
      : {}),
  };
  efRequestStructuralRosters(read);
  proof.reads = [copyComplete(read), copyComplete(read)];
  return resealEfRequest(env);
}
