import { readFileSync } from 'node:fs';

import {
  consumeAeoRoutineRevisionReplay,
  diffAeoEditingKnowledgeVersions,
  ingestAeoEditingKnowledgeCandidate,
  validateAeoEditingInput,
  validateAeoEditingKnowledgeCandidate,
  type AeoEditingActionUnit,
  type AeoEditingKnowledgeCandidate,
  type AeoEditingKnowledgeVersionDiff,
  type AeoEditingSourceRef,
  type AeoRoutineRevisionReplayCandidate,
} from '../../server/modules/aeo-authoring/aeo-editing-knowledge';

const REAL_AEO_ROOT = '/Volumes/SSD/LLM/WiseLink/output/personal-assistant/aeo';

describe('AEO current producer real artifacts', () => {
  it('ingests the two software and one hardware producer schemas with manifests', () => {
    const cases: Array<{
      directory: string;
      actionCount: number;
      actualBytes: number;
    }> = [
      {
        directory: 'AEO-B787-45-0002-R00',
        actionCount: 25,
        actualBytes: 1693595,
      },
      {
        directory: 'AEO-B787-45-0003-R00',
        actionCount: 26,
        actualBytes: 1734858,
      },
      {
        directory: 'AEO-B747-23-0008-R00',
        actionCount: 12,
        actualBytes: 18703998,
      },
    ];
    const candidates: AeoEditingKnowledgeCandidate[] = cases.map(
      (sample): AeoEditingKnowledgeCandidate => {
        const knowledge: unknown = json(
          `${REAL_AEO_ROOT}/${sample.directory}/knowledge-units.json`,
        );
        const manifest: unknown = json(
          `${REAL_AEO_ROOT}/${sample.directory}/source-manifest.json`,
        );
        expect(validateAeoEditingInput(knowledge, manifest)).toEqual({
          valid: true,
          findings: [],
        });
        const candidate: AeoEditingKnowledgeCandidate =
          ingestAeoEditingKnowledgeCandidate(knowledge, manifest);
        expect(validateAeoEditingKnowledgeCandidate(candidate).valid).toBe(
          true,
        );
        expect(candidate.actionUnits).toHaveLength(sample.actionCount);
        expect(candidate.documentIdentity.actualBytes).toBe(sample.actualBytes);
        candidate.actionUnits.forEach((unit: AeoEditingActionUnit) => {
          const keys: string[] = unit.sourceRefs.map(
            (ref: AeoEditingSourceRef) => `${ref.sourceId}#${ref.locator}`,
          );
          expect(new Set(keys).size).toBe(keys.length);
        });
        return candidate;
      },
    );

    const software: AeoEditingKnowledgeCandidate = candidates[0]!;
    const staging: AeoEditingActionUnit = software.actionUnits.find(
      (unit: AeoEditingActionUnit) =>
        unit.sourceDisposition === 'OPERATOR_DEFINED_STAGING_IMPLEMENTATION',
    )!;
    expect(software.companyStepCandidateUnitIds).toContain(staging.unitId);
    expect(software.applicableTemplateCandidateUnitIds).not.toContain(
      staging.unitId,
    );
    expect(software.missingInputs.length).toBeGreaterThan(0);
    expect(
      software.producerEvidence.sourceCandidatesRequiringDecision.length,
    ).toBeGreaterThan(0);

    const hardware: AeoEditingKnowledgeCandidate = candidates[2]!;
    expect(hardware.documentIdentity.category).toBe(
      'HARDWARE_INSTALLATION_MODIFICATION',
    );
    expect(hardware.producerEvidence.figureUnits).toHaveLength(11);
    expect(hardware.producerEvidence.reviewFlags).toHaveLength(6);
    expect(
      hardware.producerEvidence.companyAddedOrSpecializedControls,
    ).toHaveLength(4);
    expect(hardware.conflicts).toEqual(
      expect.arrayContaining([
        expect.stringContaining('wrong AEO/SB identities'),
        expect.stringContaining('initial configuration'),
      ]),
    );
  });

  it('deduplicates compact SourceRefs from a real producer record', () => {
    const directory = 'AEO-B787-45-0002-R00';
    const knowledge = json(
      `${REAL_AEO_ROOT}/${directory}/knowledge-units.json`,
    ) as Record<string, unknown>;
    const manifest: unknown = json(
      `${REAL_AEO_ROOT}/${directory}/source-manifest.json`,
    );
    const actions: Array<Record<string, unknown>> = knowledge.actions as Array<
      Record<string, unknown>
    >;
    const firstRefs: string[] = actions[0]!.sourceRefs as string[];
    actions[0]!.sourceRefs = [...firstRefs, firstRefs[0]];
    const candidate: AeoEditingKnowledgeCandidate =
      ingestAeoEditingKnowledgeCandidate(knowledge, manifest);
    expect(candidate.actionUnits[0]!.sourceRefs).toHaveLength(firstRefs.length);
  });

  it('diffs every engineering-relevant action field from a real candidate', () => {
    const directory = 'AEO-B787-45-0002-R00';
    const original: AeoEditingKnowledgeCandidate =
      ingestAeoEditingKnowledgeCandidate(
        json(`${REAL_AEO_ROOT}/${directory}/knowledge-units.json`),
        json(`${REAL_AEO_ROOT}/${directory}/source-manifest.json`),
      );
    const changed: AeoEditingKnowledgeCandidate = JSON.parse(
      JSON.stringify(original),
    ) as AeoEditingKnowledgeCandidate;
    const unit: AeoEditingActionUnit = changed.actionUnits[0]!;
    unit.conditions = [{ kind: 'CURRENT_SOURCE_REQUIRED' }];
    unit.verifications = [{ kind: 'ENGINEER_CHECK' }];
    unit.closeout = [{ kind: 'RESTORE_CANDIDATE' }];
    unit.safetyNotes = [{ text: 'Candidate safety note.' }];
    unit.inspectionDetail = {
      area: {},
      method: {},
      referenceCondition: {},
      thresholdsAndLimits: [],
      findingClassification: {},
      repeatInterval: {},
      ndt: {},
      recording: {},
      explicitAbsences: [],
    };
    unit.sourceDisposition = 'COMPANY_ADDED';
    unit.reviewStatus = 'REVIEW_REQUIRED';
    unit.sourceRefs = [
      ...unit.sourceRefs,
      { sourceId: unit.sourceRefs[0]!.sourceId, locator: 'diff-only-locator' },
    ];
    const reasons: string[] = diffAeoEditingKnowledgeVersions(original, changed)
      .changes[0]!.reasons;
    expect(reasons).toEqual(
      expect.arrayContaining([
        'conditions changed.',
        'verifications changed.',
        'closeout changed.',
        'safety notes changed.',
        'inspection detail changed.',
        'source references changed.',
        'source disposition changed.',
        'review status changed.',
      ]),
    );
  });

  it('detects sequence and dependency-only changes in a real B787 candidate', () => {
    const directory = 'AEO-B787-45-0002-R00';
    const original: AeoEditingKnowledgeCandidate =
      ingestAeoEditingKnowledgeCandidate(
        json(`${REAL_AEO_ROOT}/${directory}/knowledge-units.json`),
        json(`${REAL_AEO_ROOT}/${directory}/source-manifest.json`),
      );
    const changed: AeoEditingKnowledgeCandidate = JSON.parse(
      JSON.stringify(original),
    ) as AeoEditingKnowledgeCandidate;
    const unit: AeoEditingActionUnit = changed.actionUnits[0]!;
    const dependencyTarget: AeoEditingActionUnit = changed.actionUnits[1]!;
    unit.sequence =
      Math.max(
        ...changed.actionUnits.map(
          (action: AeoEditingActionUnit) => action.sequence,
        ),
      ) + 1;
    unit.dependencies = [
      {
        sourceUnitId: dependencyTarget.unitId,
        relationship: 'AFTER',
      },
    ];

    const diff: AeoEditingKnowledgeVersionDiff =
      diffAeoEditingKnowledgeVersions(original, changed);
    expect(
      diff.changes.find(
        (change: AeoEditingKnowledgeVersionDiff['changes'][number]) =>
          change.unitId === unit.unitId,
      ),
    ).toEqual(
      expect.objectContaining({
        change: 'CHANGED',
        reasons: ['sequence changed.', 'dependencies changed.'],
      }),
    );
    expect(
      diff.changes.filter(
        (change: AeoEditingKnowledgeVersionDiff['changes'][number]) =>
          change.change !== 'UNCHANGED',
      ),
    ).toHaveLength(1);
  });

  it('keeps the real inspection and both routine revision transitions valid', () => {
    const inspectionDirectory = 'AEO-B737-31-0034-R00';
    const inspection: AeoEditingKnowledgeCandidate =
      ingestAeoEditingKnowledgeCandidate(
        json(`${REAL_AEO_ROOT}/${inspectionDirectory}/inspection-units.json`),
        json(`${REAL_AEO_ROOT}/${inspectionDirectory}/source-manifest.json`),
      );
    expect(validateAeoEditingKnowledgeCandidate(inspection).valid).toBe(true);
    expect(inspection.actionUnits).toHaveLength(6);
    expect(inspection.companyStepCandidateUnitIds).toHaveLength(2);
    expect(
      inspection.actionUnits.filter(
        (unit: AeoEditingActionUnit) => unit.inspectionDetail !== null,
      ),
    ).toHaveLength(4);

    const crossSample: unknown = json(
      `${REAL_AEO_ROOT}/cross-sample/AEO-EDITING-V0-CATEGORY-PATTERNS.json`,
    );
    const revisionDirectory = 'AEO-B777-31-1017-R25-R27';
    const pattern: unknown = json(
      `${REAL_AEO_ROOT}/${revisionDirectory}/revision-update-pattern.json`,
    );
    const manifest: unknown = json(
      `${REAL_AEO_ROOT}/${revisionDirectory}/source-manifest.json`,
    );
    const historical: AeoRoutineRevisionReplayCandidate =
      consumeAeoRoutineRevisionReplay(
        crossSample,
        pattern,
        manifest,
        'R25_TO_R26',
      );
    const candidate: AeoRoutineRevisionReplayCandidate =
      consumeAeoRoutineRevisionReplay(crossSample, pattern, manifest);
    expect(historical.continuityCheck.valid).toBe(true);
    expect(candidate.continuityCheck.valid).toBe(true);
    expect(historical.slotEdits).toHaveLength(5);
    expect(candidate.slotEdits).toHaveLength(5);
    expect(candidate.documentState).toBe('CANDIDATE_REVISION');
  });
});

function json(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8')) as unknown;
}
