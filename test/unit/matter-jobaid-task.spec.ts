import {
  buildMatterJobAidTask,
  matterJobAidSourceRegistry,
} from '../../server/modules/canonical-host/matter-jobaid-task';
import {
  JOBAID_CORE_METHOD_REFS,
  JOBAID_METHOD_BINDING,
  JOBAID_METHOD_EVIDENCE,
} from '../../server/modules/canonical-host/jobaid-method-pack';
import type { AssessmentEvidence } from '../../shared/assessment-reading.interface';
import {
  JOBAID_PROBLEM_WORK_SCHEMA,
  type JobAidProblemWorkContent,
} from '../../shared/jobaid-problem-assessment.interface';
import type { EngineeringMatterWorkingRevisionReadModel } from '../../shared/matter-working.interface';

describe('Matter JobAid task protocol', () => {
  it('delivers the current source change and exact semantic binding independently of historical work', () => {
    const binding = { inputId: 'WI-new', workItemId: 'WI-new', workItemRevision: 3,
      documentVersionId: 'DV-new', resultRef: null, resultRevision: null,
      original: { parseRunId: 'PRUN-6', parseRevision: 6, semantic: { revision: 1, profileRef: 'boeing.ftd.sections.v1' } } };
    const task = buildMatterJobAidTask({ matterId: 'MAT-test', matterRevisionId: 'MR-1',
      actorUserId: 'actor-1', title: 'Source update', inputs: [binding],
      trigger: { kind: 'SOURCE_CHANGE', inputIds: ['WI-new'] }, previous: null });
    expect(task.modelInput.sourceChanges).toEqual([{ inputId: 'WI-new', current: binding,
      covered: null, reasons: ['NOT_COVERED'] }]);
    expect(task.modelInput.availableDocuments[0].boundOriginal).toEqual(binding.original);
    expect(task.modelInput.availableDocuments[0].readingScope).toBe('NOT_READ_THIS_ATTEMPT');
    expect(task.modelInput.trigger).toEqual({ kind: 'SOURCE_CHANGE', inputIds: ['WI-new'] });
  });

  it('rejects a previous revision that has only the retired summary shape', () => {
    expect(() => buildMatterJobAidTask({
      matterId: 'MAT-legacy',
      matterRevisionId: 'MR-1',
      actorUserId: 'actor-1',
      title: 'Legacy state',
      inputs: [],
      trigger: { kind: 'USER_REQUEST', requestId: 'REQ-1', instruction: '继续评估' },
      previous: retiredSummaryPrevious(),
    })).toThrow('JOBAID_PREVIOUS_WORK_INCOMPLETE');
  });
});

describe('matterJobAidSourceRegistry', () => {
  it('exposes the registered catalog and deduped eligible refs of retained work', () => {
    const registry = matterJobAidSourceRegistry(previousWithWork());
    expect(registry.sourceCatalog.map((item) => item.evidenceRef)).toEqual([
      ...JOBAID_METHOD_EVIDENCE.map((item) => item.evidenceRef),
      retainedEvidence.evidenceRef,
    ]);
    expect(registry.sourceCatalog.find((item) => item.evidenceRef === retainedEvidence.evidenceRef))
      .toEqual(retainedEvidence);
    for (const ref of [...JOBAID_CORE_METHOD_REFS, retainedEvidence.evidenceRef])
      expect(registry.eligibleEvidenceRefs.filter((item) => item === ref)).toHaveLength(1);
    expect(new Set(registry.eligibleEvidenceRefs).size).toBe(registry.eligibleEvidenceRefs.length);
  });

  it('delivers exactly what buildMatterJobAidTask consumes for the same previous work', () => {
    const previous = previousWithWork();
    const registry = matterJobAidSourceRegistry(previous);
    const task = buildMatterJobAidTask({
      matterId: 'MAT-test',
      matterRevisionId: 'MR-1',
      actorUserId: 'actor-1',
      title: 'Same registry',
      inputs: [],
      trigger: { kind: 'USER_REQUEST', requestId: 'REQ-2', instruction: '继续评估' },
      previous,
    });
    expect(task.sourceCatalog).toEqual(registry.sourceCatalog);
    expect(task.initiallyDeliveredRefs).toEqual(registry.eligibleEvidenceRefs);
  });

  it('uses only the method roster when there is no previous work', () => {
    const registry = matterJobAidSourceRegistry(null);
    expect(registry.sourceCatalog.map((item) => item.evidenceRef))
      .toEqual(JOBAID_METHOD_EVIDENCE.map((item) => item.evidenceRef));
    expect(registry.eligibleEvidenceRefs).toEqual([...JOBAID_CORE_METHOD_REFS]);
  });

  it('rejects previous work that lost the problem work content', () => {
    expect(() => matterJobAidSourceRegistry(retiredSummaryPrevious()))
      .toThrow('JOBAID_PREVIOUS_WORK_INCOMPLETE');
  });

  it('rejects a retained source whose registered content changed', () => {
    const forged = { ...JOBAID_METHOD_EVIDENCE[0], title: 'Forged method title' };
    const previous = previousWithWork({ evidence: [forged] });
    expect(() => matterJobAidSourceRegistry(previous)).toThrow('JOBAID_PRIOR_SOURCE_CHANGED');
  });

  it('rejects an eligible ref missing from the registered catalog', () => {
    const previous = previousWithWork({ readSourceRefs: ['EV-not-registered'] });
    expect(() => matterJobAidSourceRegistry(previous)).toThrow('JOBAID_PRIOR_SOURCE_MISSING');
  });
});

const retainedEvidence: AssessmentEvidence = {
  kind: 'DOCUMENT_PASSAGE',
  documentVersionId: 'DV-1',
  workItemId: null,
  evidenceRef: 'EV-retained-1',
  sourceRefId: 'EV-retained-1',
  title: 'Retained source',
  versionLabel: null,
  locator: 'PDF page 2',
  excerpt: 'The bounded condition stays registered.',
};

function retainedProblemWork(overrides: Partial<JobAidProblemWorkContent> = {}): JobAidProblemWorkContent {
  return {
    schemaVersion: JOBAID_PROBLEM_WORK_SCHEMA,
    headline: 'Headline',
    listBrief: 'Brief',
    understanding: 'Understanding',
    decisiveIssueKeys: [],
    overviewStatus: 'CURRENT',
    issues: [],
    roundCompletion: 'COMPLETE',
    completionReason: 'Done',
    changeSummary: 'Saved work',
    unchangedExplanation: '',
    methodBinding: JOBAID_METHOD_BINDING,
    evidence: [retainedEvidence],
    readSourceRefs: [retainedEvidence.evidenceRef, retainedEvidence.evidenceRef],
    capabilities: [],
    historyReview: {
      required: false,
      priorAssessmentRefs: [],
      engineeringDocumentRefs: [],
      coverage: 'NOT_REQUIRED',
      limitation: null,
    },
    ...overrides,
  };
}

function previousWithWork(
  workOverrides: Partial<JobAidProblemWorkContent> = {},
): EngineeringMatterWorkingRevisionReadModel {
  const previous = retiredSummaryPrevious();
  return {
    ...previous,
    state: { ...previous.state, problemWork: retainedProblemWork(workOverrides) },
  };
}

function retiredSummaryPrevious(): EngineeringMatterWorkingRevisionReadModel {
  return {
    matterWorkRevisionId: 'MWR-1',
    matterId: 'MAT-legacy',
    workingRevision: 1,
    basedOnMatterRevisionId: 'MR-0',
    updateKind: 'INITIAL_SYNTHESIS',
    changeSummary: '旧摘要',
    substantiveResultRef: 'RESULT-1',
    substantiveResultRevision: 1,
    state: {
      schemaVersion: 'wiselink.3_1.engineering_matter_working_state.v1',
      focus: { question: '旧问题', targetRefs: [] },
      substantiveResult: null,
      openQuestions: [],
      reviewConditions: [],
      substantiveInputs: [],
      coverage: [],
    },
    change: {
      changedBecause: null,
      addedClaimIds: [],
      replacedClaimIds: [],
      retiredClaims: [],
      explicitlyUnchangedClaimIds: [],
      openQuestionDelta: null,
      reviewConditionDelta: null,
      coverageUpdates: [],
    },
    source: null,
    createdAt: '2026-09-12T00:00:00.000Z',
  };
}
