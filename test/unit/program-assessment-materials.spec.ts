import { canonicalJson } from '../../server/modules/action-attempt/action-attempt-envelope';
import { taskModelSelection } from '../../server/modules/model-settings/canonical-model-catalog';
import { assertProgramCompleteIssueCoverage, parseProgramMaterialSnapshot, programMaterialsObservation } from '../../server/modules/canonical-host/program-assessment-materials';
import type { JobAidProblemTaskInput } from '../../server/modules/canonical-host/jobaid-problem-task';
import type { OpenClawTaskEnvelope } from '../../server/modules/action-attempt/action-attempt-envelope.types';

function fixture() {
  const previousWork = {workRevisionRef: 'work-1', workRevision: 1,
    content: {issues: [{issueKey: 'A'}, {issueKey: 'B'}], understanding: 'Complete previous body'}};
  const modelInput = {executionMode: 'PROGRAM_CONTROLLED_V1', previousWork};
  const executionModel = taskModelSelection('miaoda/glm-5.3');
  const task = {executionModel} as OpenClawTaskEnvelope;
  const input = {executionMode: 'PROGRAM_CONTROLLED_V1', modelInput, previousWork, sourceCatalog: []} as unknown as JobAidProblemTaskInput;
  const materials = {version: 1, originalInput: modelInput, previousWorkRead: {revision: previousWork},
    sourceReads: [], deliveredEvidenceRefs: [], modelInput: {continuousOriginal: {content: 'Exact original'}}};
  const modelRequest = {version: 1, executionModel, materialCheckpoint: 'program-materials',
    body: canonicalJson({messages: [{role: 'system', content: 'Analyze'}, {role: 'user', content: canonicalJson(materials.modelInput)}]})};
  return {task, input, snapshot: structuredClone({materials, modelRequest})};
}

describe('program prepared material artifact contract', () => {
  it('retains exact original material, full previous work, and serialized model request', () => {
    const f = fixture();
    expect(parseProgramMaterialSnapshot(f.snapshot, f.task, f.input)).toEqual(f.snapshot);
  });
  it.each(['model', 'input', 'previous', 'request'] as const)('rejects changed %s binding', field => {
    const f = fixture();
    if (field === 'model') f.snapshot.modelRequest.executionModel = {...f.snapshot.modelRequest.executionModel, modelRef: 'changed-model'};
    if (field === 'input') f.snapshot.materials.originalInput = { ...f.snapshot.materials.originalInput, executionMode: 'OTHER'};
    if (field === 'previous') f.snapshot.materials.previousWorkRead.revision.workRevisionRef = 'latest-not-exact';
    if (field === 'request') f.snapshot.modelRequest.body = canonicalJson({messages: [{role:'system'}, {role:'user',content:'new input'}]});
    expect(() => parseProgramMaterialSnapshot(f.snapshot, f.task, f.input)).toThrow();
  });
  it('exposes only an artifact pointer in progress, never reconstructs a missing snapshot', () => {
    expect(programMaterialsObservation(JSON.stringify([{kind:'ASSESSMENT_PROGRAM_PROGRESS',phase:'MATERIALS_READY',observedAt:'2026-10-25T00:00:00Z'}]))).toBeNull();
    const artifact = {ref:'artifact://exact',sha256:'a'.repeat(64),byteLength:123,storeRole:'UnifiedArtifactStoreCandidate',mediaType:'application/json'};
    expect(programMaterialsObservation(JSON.stringify([{kind:'ASSESSMENT_PROGRAM_PROGRESS',phase:'MATERIALS_READY',materialsArtifact:artifact,observedAt:'2026-10-25T00:00:00Z'}])))
      .toEqual({artifact,observedAt:'2026-10-25T00:00:00Z'});
  });
  it('requires explicit treatment of retained issues while allowing unchanged or retired declarations', () => {
    const {input} = fixture();
    const partial = {roundCompletion:'COMPLETE',issues:[{issueKey:'A'}]};
    expect(() => assertProgramCompleteIssueCoverage(partial,input)).toThrow('JOBAID_PROGRAM_PREVIOUS_ISSUE_COVERAGE_REQUIRED');
    expect(() => assertProgramCompleteIssueCoverage({...partial,unchangedIssueKeys:['B']},input)).not.toThrow();
    expect(() => assertProgramCompleteIssueCoverage({...partial,retiredIssues:[{issueKey:'B',reason:'superseded'}]},input)).not.toThrow();
    expect(() => assertProgramCompleteIssueCoverage({...partial,roundCompletion:'IN_PROGRESS'},input)).not.toThrow();
    expect(() => assertProgramCompleteIssueCoverage(partial,{...input,executionMode:undefined})).not.toThrow();
  });
});
