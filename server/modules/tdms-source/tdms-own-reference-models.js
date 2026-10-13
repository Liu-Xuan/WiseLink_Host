// Pure contract from frozen TDMS 0.2.54; no runtime or source authority.
// Pure native field semantics. No collector, caller-provided role, source type
// inference, or completion state is consulted here.
export const OWN_REFERENCE_MODEL_REVISION = 'tdms-own-field-reference-models@1';
const ENGINEERING = Object.freeze(['EO', 'EF', 'AEO']);
const DOCUMENTS = Object.freeze(['SB', 'SIL', 'SB-IN', 'SL', 'MT', 'AD']);
const OBSERVED_SCOPES = Object.freeze([
  ...DOCUMENTS,
  'AD_PROCESSING_FORM',
  'SB_PROCESSING_FORM',
  'SB_ASSESSMENT_FORM',
  ...ENGINEERING,
]);
const userLabels = Object.freeze([
  'Created By:',
  'Modified By:',
  'Change Admin I:',
  'Change Admin II:',
  '作者:',
  '校对人:',
  '审核人:',
  '编写人:',
  '原创建者:',
]);
// Field labels are already reviewed in the native primary fragments and the
// AD/SB/EO visible-content captures. This names current references only: every
// WTDocument/EPMDocument target still needs its own native type/subtype read.
const CURRENT = Object.freeze([
  { scopes: ENGINEERING, label: 'AD编号:', classes: ['wt.doc.WTDocument'] },
  { scopes: ENGINEERING, label: 'SB编号:', classes: ['wt.doc.WTDocument'] },
  {
    scopes: ENGINEERING,
    label: '处理单号:',
    classes: ['wt.change2.WTChangeRequest2'],
  },
  { scopes: ENGINEERING, label: '等效:', classes: ['wt.epm.EPMDocument'] },
  { scopes: ENGINEERING, label: '取代:', classes: ['wt.epm.EPMDocument'] },
  {
    scopes: ['SB_PROCESSING_FORM'],
    label: 'SB/SL文件编号:',
    classes: ['wt.doc.WTDocument'],
  },
]);
const OUTSIDE = Object.freeze([
  ...['Created By:', 'Modified By:'].map((label) => ({
    scopes: ['ENGINEERING_ASSESSMENT'],
    label,
    classes: ['wt.org.WTUser'],
  })),
  {
    scopes: ['ENGINEERING_ASSESSMENT'],
    label: 'Context:',
    classes: ['wt.inf.library.WTLibrary', 'wt.pdmlink.PDMLinkProduct'],
  },
  {
    scopes: ['ENGINEERING_ASSESSMENT'],
    label: 'Location:',
    classes: ['wt.folder.Cabinet', 'wt.folder.SubFolder'],
  },
  ...userLabels.map((label) => ({
    scopes: OBSERVED_SCOPES,
    label,
    classes: ['wt.org.WTUser'],
  })),
  {
    scopes: OBSERVED_SCOPES,
    label: 'Context:',
    classes: ['wt.inf.library.WTLibrary', 'wt.pdmlink.PDMLinkProduct'],
  },
  ...[
    '受影响的飞机:',
    '受影响的发动机:',
    '受影响的APU:',
    '受影响的起落架:',
    '受影响的附件:',
  ].map((label) => ({
    scopes: ['SB_ASSESSMENT_FORM'],
    label,
    classes: ['wt.part.WTPart'],
  })),
]);
export const OWN_OUT_OF_SCOPE_NATIVE_CLASSES = Object.freeze([
  'wt.org.WTUser',
  'wt.inf.library.WTLibrary',
  'wt.pdmlink.PDMLinkProduct',
  'wt.folder.Cabinet',
  'wt.folder.SubFolder',
]);
const nativeClass = (ref) =>
  typeof ref === 'string'
    ? (ref.match(
        /^(?:OR|VR):([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)+):\d{1,24}$/u,
      )?.[1] ?? null)
    : null;
const match = (models, scope, label, type) =>
  models.some(
    (m) =>
      m.scopes.includes(scope) && m.label === label && m.classes.includes(type),
  );
export function classifyOwnFieldReference({
  scopeId,
  fieldActualLabel,
  targetRef,
}) {
  const type = nativeClass(targetRef);
  if (match(CURRENT, scopeId, fieldActualLabel, type))
    return {
      relationshipRole: 'CURRENT_CONTENT',
      modelRoleOrigin: 'REVIEWED_OWN_FIELD_MODEL',
      direction: 'SOURCE_TO_TARGET',
    };
  if (match(OUTSIDE, scopeId, fieldActualLabel, type))
    return {
      relationshipRole: 'OUT_OF_SCOPE_REFERENCE',
      modelRoleOrigin: 'REVIEWED_OUT_OF_SCOPE_OWN_FIELD_MODEL',
      direction: 'SOURCE_TO_TARGET',
    };
  return {
    relationshipRole: 'UNKNOWN',
    modelRoleOrigin: 'UNREVIEWED_OWN_FIELD',
    direction: 'UNKNOWN',
  };
}
export function isReviewedOutOfScopeOwnReference(input) {
  return (
    classifyOwnFieldReference(input).relationshipRole ===
    'OUT_OF_SCOPE_REFERENCE'
  );
}
