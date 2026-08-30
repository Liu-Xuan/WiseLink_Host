import {
  AEO_EDITING_TEST_ACTOR as ACTOR,
  aeoEditingHarness as harness,
} from '../fixtures/canonical-host-aeo-editing.fixture';

describe('CanonicalHostAeoEditingService real AEO product wiring', () => {
  it('persists B787 steps and company additions as source-bound candidate blocks', async () => {
    const target = harness('AEO-B787-45-0002-R00');
    const readModel = await target.service.createDraft(
      target.state.workItem.workItemId,
      { expectedRevision: target.state.workItem.revision },
      ACTOR,
    );

    expect(readModel.status).toBe('CANDIDATE_ONLY');
    expect(readModel.suggestions).toHaveLength(25);
    expect(readModel.blocks).toHaveLength(25);
    expect(
      readModel.suggestions
        .filter((suggestion) => suggestion.kind === 'COMPANY_STEP_CANDIDATE')
        .map((suggestion) => suggestion.sourceUnitId),
    ).toEqual(target.knowledge.companyStepCandidateUnitIds);
    expect(readModel.blocks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceBindings: expect.arrayContaining([
            expect.objectContaining({
              sourceArtifactRef: expect.stringMatching(
                /^artifact:\/\/canonical-host\/aeo-sources\//u,
              ),
              sourceSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
            }),
          ]),
        }),
      ]),
    );
    expect(
      readModel.sources.every((source) => !source.artifactRef.startsWith('/')),
    ).toBe(true);
    expect(readModel.adoptionDecisions).toEqual([]);
    expect(readModel.authority).toEqual(
      expect.objectContaining({
        candidateOnly: true,
        automaticallyAdopted: false,
        engineeringApproved: false,
        productionPublished: false,
        currentChanged: false,
      }),
    );

    const reread = await target.service.readDraft(
      target.state.workItem.workItemId,
      ACTOR,
    );
    expect(reread.projection.artifact).toEqual(readModel.projection.artifact);
    expect(reread.blocks).toEqual(readModel.blocks);
    expect(target.repository.completeAssessmentAction).toHaveBeenCalledTimes(1);
    expect(
      target.authorization.authorize.mock.calls.map(([call]) => call.action),
    ).toEqual(['CREATE_AEO_EDITING_DRAFT', 'READ_AEO_EDITING_DRAFT']);
    expect(target.registrar.compareAndSet).toHaveBeenCalledWith(
      expect.objectContaining({
        workItemId: 'WI-AEO-B787-45-0002-R00',
        expectedRevision: 7,
        syncPrimaryAttempt: false,
      }),
    );
  });

  it('keeps every B747 typed figure/table and specialized control as a source-bound blocking gap', async () => {
    const target = harness('AEO-B747-23-0008-R00');
    const readModel = await target.service.createDraft(
      target.state.workItem.workItemId,
      { expectedRevision: target.state.workItem.revision },
      ACTOR,
    );

    expect(readModel.suggestions).toHaveLength(12);
    expect(
      readModel.blockingGaps.filter(
        (gap) => gap.code === 'AEO_TYPED_FIGURE_OR_TABLE_NOT_PROJECTED',
      ),
    ).toHaveLength(11);
    expect(
      readModel.blockingGaps.filter(
        (gap) =>
          gap.code === 'AEO_SPECIALIZED_CONTROL_REQUIRES_ENGINEER_REVIEW',
      ),
    ).toHaveLength(4);
    expect(
      readModel.blockingGaps
        .filter(
          (gap) =>
            gap.code === 'AEO_TYPED_FIGURE_OR_TABLE_NOT_PROJECTED' ||
            gap.code === 'AEO_SPECIALIZED_CONTROL_REQUIRES_ENGINEER_REVIEW',
        )
        .every(
          (gap) =>
            gap.blocking &&
            gap.sourceRefs.length > 0 &&
            gap.sourceRefs.every((ref) => ref.sourceId !== 'MISSING_SOURCE'),
        ),
    ).toBe(true);
    expect(
      readModel.blocks.some(
        (block) =>
          block.blockType === 'IMAGE' || block.blockType === 'DATA_TABLE',
      ),
    ).toBe(false);
    expect(readModel.adoptionDecisions).toEqual([]);
  });

  it('preserves both real B737 inspection conditions and their exact unit SourceRefs', async () => {
    const target = harness('AEO-B737-31-0034-R00');
    const readModel = await target.service.createDraft(
      target.state.workItem.workItemId,
      { expectedRevision: target.state.workItem.revision },
      ACTOR,
    );
    const inspection = readModel.suggestions.find(
      (suggestion) => suggestion.sourceUnitId === 'AEO-310034-2',
    );
    const correction = readModel.suggestions.find(
      (suggestion) => suggestion.sourceUnitId === 'AEO-310034-3',
    );

    expect(inspection?.conditions).toEqual([
      'whether the fiber-optic line is included in the final bundle tie prior to breakout',
    ]);
    expect(inspection?.sourceRefs).toEqual(
      expect.arrayContaining([
        {
          sourceId: 'SRC-BOEING-737-SL-31-091',
          locator: 'p2-suggested-operator-action',
        },
        {
          sourceId: 'SRC-AEO-310034-R00-SECTION2-PDF',
          locator: 'p2-item-2',
        },
      ]),
    );
    expect(inspection?.conditionSourceRefs).toEqual(inspection?.sourceRefs);
    expect(correction?.conditions).toEqual(['ERROR_PRESENT in Step 2']);
    expect(correction?.inspectionDetail).toEqual(
      expect.objectContaining({
        method: expect.objectContaining({ type: 'VISUAL' }),
        explicitAbsences: expect.arrayContaining([
          'repeat interval',
          'NDT method',
        ]),
      }),
    );
    expect(correction?.sourceRefs).toEqual(
      expect.arrayContaining([
        {
          sourceId: 'SRC-BOEING-737-SL-31-091',
          locator: 'p7',
        },
        {
          sourceId: 'SRC-AEO-310034-R00-SECTION2-PDF',
          locator: 'p7',
        },
      ]),
    );
    expect(correction?.conditionSourceRefs).toEqual(correction?.sourceRefs);
    expect(readModel.blockingGaps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'AEO_MISSING_INPUT',
          sourceRefs: [expect.objectContaining({ sourceId: 'MISSING_SOURCE' })],
        }),
      ]),
    );
  });

  it('persists generation-bound DO_NOT_LEARN feedback without an adoption decision', async () => {
    const target = harness('AEO-B787-45-0003-R00');
    const base = await target.service.createDraft(
      target.state.workItem.workItemId,
      { expectedRevision: target.state.workItem.revision },
      ACTOR,
    );
    expect(base.suggestions).toHaveLength(26);
    const selected = base.suggestions[0]!;
    const updated = await target.service.recordFeedback(
      target.state.workItem.workItemId,
      {
        expectedRevision: base.workItemRevision,
        feedbackId: 'FEEDBACK-DO-NOT-LEARN-1',
        suggestionId: selected.suggestionId,
        expectedGenerationRevision: base.generationRevision,
        decision: 'ACCEPT',
        note: 'Accepted only for this candidate; do not learn this occurrence.',
        semanticField: 'SUGGESTION',
        reasonCode: 'APPLICABILITY',
        learningDisposition: 'DO_NOT_LEARN',
      },
      ACTOR,
    );

    expect(updated.feedback).toEqual([
      expect.objectContaining({
        feedbackId: 'FEEDBACK-DO-NOT-LEARN-1',
        targetGenerationRevision: 1,
        learningDisposition: 'DO_NOT_LEARN',
        engineerDecisionRef: expect.stringMatching(
          /^aeo-feedback:\/\/canonical-host\/[a-f0-9]{64}$/u,
        ),
        sourceRefs: selected.sourceRefs,
      }),
    ]);
    expect(updated.learning).toEqual({
      eligibleFeedbackCount: 0,
      excludedDoNotLearnFeedbackIds: ['FEEDBACK-DO-NOT-LEARN-1'],
      boundary: 'FEEDBACK_INPUT_NOT_AUTOMATIC_RULE_NOT_AUTHORITY',
    });
    expect(updated.projection.doNotLearnFeedbackCount).toBe(1);
    expect(updated.adoptionDecisions).toEqual([]);
    expect(updated.authority.engineeringApproved).toBe(false);
  });

  it('rejects outsider and stale-revision calls before producer/manifest or persistence I/O', async () => {
    const outsider = harness('AEO-B787-45-0002-R00', true);
    await expect(
      outsider.service.createDraft(
        outsider.state.workItem.workItemId,
        { expectedRevision: outsider.state.workItem.revision },
        ACTOR,
      ),
    ).rejects.toMatchObject({
      code: 'CANONICAL_WORK_ITEM_NOT_FOUND',
      statusCode: 404,
    });
    expect(outsider.artifacts.readActualBytes).not.toHaveBeenCalled();
    expect(outsider.repository.reserveAssessmentAction).not.toHaveBeenCalled();

    const stale = harness('AEO-B787-45-0002-R00');
    await expect(
      stale.service.createDraft(
        stale.state.workItem.workItemId,
        { expectedRevision: stale.state.workItem.revision - 1 },
        ACTOR,
      ),
    ).rejects.toThrow('WORK_ITEM_CAS_CONFLICT');
    expect(stale.artifacts.readActualBytes).not.toHaveBeenCalled();
    expect(stale.repository.reserveAssessmentAction).not.toHaveBeenCalled();
  });

  it('fails closed when a Host source binding does not match the actual manifest', async () => {
    const target = harness('AEO-B747-23-0008-R00');
    target.state.workItem.aeoEditingInput!.sourceArtifacts[0] = {
      ...target.state.workItem.aeoEditingInput!.sourceArtifacts[0]!,
      artifactSha256: 'f'.repeat(64),
    };
    await expect(
      target.service.createDraft(
        target.state.workItem.workItemId,
        { expectedRevision: target.state.workItem.revision },
        ACTOR,
      ),
    ).rejects.toThrow('AEO_EDITING_INPUT_SOURCE_BINDING_MISMATCH');
    expect(target.repository.reserveAssessmentAction).not.toHaveBeenCalled();
    expect(target.artifacts.persistAndReadback).not.toHaveBeenCalled();
  });

  it('rejects producer bytes that do not match the Host-owned descriptor', async () => {
    const target = harness('AEO-B787-45-0002-R00');
    const producerRef =
      target.state.workItem.aeoEditingInput!.currentProducerArtifact.ref;
    target.byteStore.set(
      producerRef,
      new TextEncoder().encode('{"tampered":true}'),
    );
    await expect(
      target.service.createDraft(
        target.state.workItem.workItemId,
        { expectedRevision: target.state.workItem.revision },
        ACTOR,
      ),
    ).rejects.toThrow('AEO_EDITING_CURRENT_PRODUCER_ACTUAL_BYTES_MISMATCH');
    expect(target.repository.reserveAssessmentAction).not.toHaveBeenCalled();
    expect(target.artifacts.persistAndReadback).not.toHaveBeenCalled();
  });

  it('does not publish the candidate pointer when the WorkItem CAS loses a race', async () => {
    const target = harness('AEO-B787-45-0002-R00');
    target.registrar.compareAndSet.mockRejectedValueOnce(
      new Error('WORK_ITEM_CAS_CONFLICT'),
    );
    await expect(
      target.service.createDraft(
        target.state.workItem.workItemId,
        { expectedRevision: target.state.workItem.revision },
        ACTOR,
      ),
    ).rejects.toThrow('WORK_ITEM_CAS_CONFLICT');
    expect(target.state.workItem.aeoEditingDraft).toBeNull();
    expect(target.repository.completeAssessmentAction).not.toHaveBeenCalled();
    expect(target.repository.failAssessmentAction).toHaveBeenCalledWith(
      expect.objectContaining({ errorCode: 'WORK_ITEM_CAS_CONFLICT' }),
    );
  });
});
