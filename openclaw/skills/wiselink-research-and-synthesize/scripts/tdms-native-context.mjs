import { isDeepStrictEqual } from 'node:util';
/** Optional v1 addon. Old tasks remain byte-identical. This validates transport
 * structure only; current ACL, exact source membership and lease belong to Host. */
export function assertTdmsNativeInput(input) {
  const native = (input.availableSources ?? []).filter(row => row.kind === 'TDMS_NATIVE_RECORD');
  const delivered = (input.deliveredEvidence ?? []).filter(row => row.kind === 'TDMS_NATIVE_RECORD');
  if (input.tdmsContext === undefined) {
    if (native.length || delivered.length) fail('CONTEXT_REQUIRED');
    return;
  }
  const context = input.tdmsContext;
  exact(context, ['schemaVersion','projection']);
  if (context.schemaVersion !== 'wiselink.tdms-runtime-context.v1' || input.purpose === 'PROBLEM_REVIEW') fail('VERSION_INVALID');
  const projection = context.projection;
  exact(projection,['opinions','contradictions','selectedSetApprovedRefs','historicalCohortApprovedRefs','cohorts','readPerformed','interpretation']);
  if (projection.readPerformed !== false || projection.interpretation !== 'APPROVED_PROFESSIONAL_JUDGMENT_NOT_INFALLIBLE' || delivered.length) fail('DIRECTORY_ONLY_REQUIRED');
  for (const name of ['opinions','contradictions','selectedSetApprovedRefs','historicalCohortApprovedRefs','cohorts']) if (!Array.isArray(projection[name])) fail('METADATA_INVALID');
  const refs = new Set();
  for (const opinion of projection.opinions) {
    exact(opinion,['evidenceRef','scope','assessment','fieldPath','sourceSelector','author','lane','approval','sourceVerification','readPerformed','engineeringAdoption','executionVerified']);
    if (opinion.readPerformed !== false || opinion.sourceVerification !== 'DECLARED_ONLY' || opinion.engineeringAdoption !== 'NOT_CREATED' || opinion.executionVerified !== false ||
      typeof opinion.evidenceRef !== 'string' || refs.has(opinion.evidenceRef) || !/^content\.opinions\[\d+\]$/u.test(opinion.fieldPath)) fail('METADATA_INVALID');
    exact(opinion.scope,['tenantId','sourceKey','sourceInstanceId','scopeId']);
    exact(opinion.assessment,['recordRef','sourceRevisionRef','sourceRecordId','sourceVersion','businessVersion']);
    exact(opinion.approval,['captureRef','evidencePath','mode']);
    if (opinion.approval.evidencePath !== 'rawFields.opinionCollection') fail('METADATA_INVALID');
    refs.add(opinion.evidenceRef);
  }
  for (const cohort of projection.cohorts) {
    exact(cohort,['scope','setRevisionRef','processingFamilyRef','cohortRef','processingObservationRef','rootBindings','selection','membershipCoverage','versionMappingCoverage','approvedBodyCaptureCoverage','approvalReadiness','currentness','members','approvedOpinionRefs','qualifiedOpinionRefs','revokedOpinionRefs','gaps']);
    if (!Array.isArray(cohort.members) || cohort.selection !== 'HOST_SELECTED') fail('METADATA_INVALID');
    for (const member of cohort.members) {
      exact(member,['memberRef','assessmentObservationRef','membershipResolution','opinionRefs','contributorRefs','responsibilityRefs','ataScopes','evidenceRefs','opinionContributions','status']);
      if (!Array.isArray(member.opinionRefs) || !Array.isArray(member.opinionContributions)) fail('METADATA_INVALID');
      for (const c of member.opinionContributions) exact(c,['opinionRef','contributorRefs','responsibilityRefs','ataScopes','assertionRefs']);
    }
  }
  if (projection.selectedSetApprovedRefs.some(ref => !refs.has(ref) || !native.some(row=>row.ref===ref)) ||
      new Set(projection.selectedSetApprovedRefs).size !== projection.selectedSetApprovedRefs.length) fail('DIRECTORY_INVALID');
}

export function assertTdmsNativeReadPacket(packet) {
  if (!packet || typeof packet !== 'object') return;
  const native = (packet.evidence ?? []).filter(item => item.kind === 'TDMS_NATIVE_RECORD');
  if (!native.length && packet.nativeReadReceipts === undefined) return;
  if (!Array.isArray(packet.nativeReadReceipts) || packet.nativeReadReceipts.length !== native.length ||
      new Set(native.map(item=>item.evidenceRef)).size !== native.length) fail('READ_RECEIPT_INVALID');
  for (const item of native) {
    const scope = item.nativeScope, source = item.nativeSource, receipt = item.nativeReadReceipt;
    assertTdmsNativeReadReceipt(receipt);
    if (!scope || !source || !receipt || source.recordKind !== 'ENGINEER_ASSESSMENT' || source.state?.rawName !== 'Estimated' ||
        !(source.state.rawCode === null || source.state.rawCode === 'Estimated') || scope.sourceRevisionRef !== source.sourceRevisionRef ||
        scope.processingSetBinding?.assessmentObservationRef !== source.sourceRevisionRef || !Array.isArray(scope.fieldSelectors) || !scope.fieldSelectors.length ||
        receipt.purpose !== 'JOB_AID_NATIVE_RECORD' || receipt.readPerformed !== true || receipt.executionVerified !== false || receipt.engineeringAdoption !== 'NOT_CREATED' ||
        receipt.sourceRevisionRef !== source.sourceRevisionRef || !receipt.taskContextRef || !receipt.permissionRevision || !receipt.receiptRef ||
        !isDeepStrictEqual(receipt.fieldPaths,scope.fieldSelectors.map(f=>f.fieldPath)) ||
        !packet.sourceRefs.includes(item.evidenceRef) || !packet.nativeReadReceipts.some(value=>isDeepStrictEqual(value,receipt))) fail('READ_RECEIPT_INVALID');
    const approval = scope.approval;
    if (!approval || approval.mode !== 'EXACT_VERSION' || approval.evidencePath !== 'rawFields.opinionCollection' ||
      [approval.approvalSubject,approval.before,approval.after].some(o=>!o || o.sourceRecordId!==source.sourceRecordId || !isDeepStrictEqual(o.sourceVersion,source.sourceVersion)) ||
      [approval.before,approval.after].some(o=>o.recordKind!=='ENGINEER_ASSESSMENT'||o.objectBinding!=='EXACT_CURRENT_DETAIL'||o.state?.rawName!=='Estimated'||!(o.state.rawCode===null||o.state.rawCode==='Estimated'))) fail('READ_APPROVAL_INVALID');
  }
}
function exact(value,keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== keys.length || keys.some(k=>!Object.hasOwn(value,k))) fail('METADATA_INVALID');
}
function fail(code) { throw new Error(`JOBAID_TDMS_${code}`); }

/** Equality of one exact source body, not proof of a READ or permission. Both
 * original receipt-bearing carriers remain in their immutable member snapshots. */
export function sameTdmsNativeEvidenceBody(left, right) {
  if (left?.kind !== 'TDMS_NATIVE_RECORD' || right?.kind !== 'TDMS_NATIVE_RECORD') return false;
  for (const evidence of [left,right]) assertTdmsNativeReadPacket({sourceRefs:[evidence.evidenceRef],evidence:[evidence],nativeReadReceipts:[evidence.nativeReadReceipt]});
  const {nativeReadReceipt:_left,...a}=left;
  const {nativeReadReceipt:_right,...b}=right;
  return isDeepStrictEqual(a,b);
}


export function assertTdmsNativeReadReceipt(receipt) {
  exact(receipt,['receiptRef','sourceRevisionRef','readAt','purpose','fieldPaths','taskContextRef','readPerformed','permissionRevision','engineeringAdoption','executionVerified']);
  if (['receiptRef','sourceRevisionRef','taskContextRef','permissionRevision'].some(key=>typeof receipt[key]!=='string'||!receipt[key].trim()) ||
      typeof receipt.readAt!=='string' || !/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/u.test(receipt.readAt) ||
      !Number.isFinite(Date.parse(receipt.readAt)) || new Date(`${receipt.readAt.slice(0,10)}T00:00:00.000Z`).toISOString().slice(0,10)!==receipt.readAt.slice(0,10) ||
      !Array.isArray(receipt.fieldPaths)||!receipt.fieldPaths.length||new Set(receipt.fieldPaths).size!==receipt.fieldPaths.length ||
      receipt.fieldPaths.some(path=>typeof path!=='string'||!path.trim()) || receipt.purpose!=='JOB_AID_NATIVE_RECORD' ||
      receipt.readPerformed!==true||receipt.engineeringAdoption!=='NOT_CREATED'||receipt.executionVerified!==false) fail('READ_RECEIPT_INVALID');
}
