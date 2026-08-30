import {
  AEO_EDITING_TEST_ACTOR as ACTOR,
  aeoEditingHarness as harness,
} from '../fixtures/canonical-host-aeo-editing.fixture';

describe('CanonicalHostAeoEditingService real AEO product wiring', () => {
  it('persists B787 steps and company additions as source-bound candidate blocks', async () => {
    const target = harness('AEO-B787-45-0002-R00');
    const readModel = await target.service.createDraft(
      target.state.workItem.workItemId,
      target.createRequest(),
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
          sourceRefs: expect.arrayContaining([
            expect.objectContaining({ sourceId: expect.any(String) }),
          ]),
        }),
      ]),
    );
    expect(forbiddenBrowserKeys(readModel)).toEqual([]);
    expect(JSON.stringify(readModel)).not.toContain('artifact://');
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
    expect(reread.projection).toEqual(readModel.projection);
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
      target.createRequest(),
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
      readModel.blocks.every((block) => block.blockType === 'PARAGRAPH'),
    ).toBe(true);
    expect(readModel.adoptionDecisions).toEqual([]);
  });

  it('preserves both real B737 inspection conditions and their exact unit SourceRefs', async () => {
    const target = harness('AEO-B737-31-0034-R00');
    const readModel = await target.service.createDraft(
      target.state.workItem.workItemId,
      target.createRequest(),
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

  it('reads every real B777 source byte but keeps the routine revision pattern at zero suggestions', async () => {
    const target = harness('AEO-B777-31-1017-R25-R27');
    const readModel = await target.service.createDraft(
      target.state.workItem.workItemId,
      target.createRequest(),
      ACTOR,
    );

    expect(readModel.suggestions).toEqual([]);
    expect(readModel.blocks).toEqual([]);
    expect(readModel.blockingGaps).toEqual([
      expect.objectContaining({
        code: 'AEO_ROUTINE_SERIES_PATTERN_NOT_GENERIC',
        blocking: true,
      }),
    ]);
    expect(readModel.sources).toHaveLength(target.sourceRows.size);
    expect(target.resolver.resolve).toHaveBeenCalledTimes(
      target.sourceRows.size,
    );
    expect(readModel.adoptionDecisions).toEqual([]);
    expect(forbiddenBrowserKeys(readModel)).toEqual([]);
  });

  it('rejects a B777 routine alias that names an undeclared source before draft persistence', async () => {
    const target = harness('AEO-B777-31-1017-R25-R27');
    const request = target.replaceProducer((producer) => {
      const aliases = producer.sourceRefs as Record<
        string,
        Record<string, unknown>
      >;
      aliases.r25Aeo!.sourceId = 'SRC-UNDECLARED-ADVERSARIAL';
    });
    await expect(
      target.service.createDraft(
        target.state.workItem.workItemId,
        request,
        ACTOR,
      ),
    ).rejects.toThrow('AEO_ROUTINE_SERIES_PATTERN_SOURCE_REF_UNDECLARED');
    expect(target.repository.reserveAssessmentAction).not.toHaveBeenCalled();
    expect(target.artifacts.persistAndReadback).not.toHaveBeenCalled();
    expect(target.state.workItem.aeoEditingInput).toBeNull();
    expect(target.state.workItem.aeoEditingDraft).toBeNull();
  });

  it('persists generation-bound DO_NOT_LEARN feedback without an adoption decision', async () => {
    const target = harness('AEO-B787-45-0003-R00');
    const base = await target.service.createDraft(
      target.state.workItem.workItemId,
      target.createRequest(),
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

  it('regenerates only changed units, retains unaffected MODIFY, and supersedes affected feedback', async () => {
    const target = harness('AEO-B787-45-0002-R00');
    const base = await target.service.createDraft(
      target.state.workItem.workItemId,
      target.createRequest(),
      ACTOR,
    );
    const unaffected = base.suggestions[0]!;
    const affected = base.suggestions[1]!;
    const afterUnaffected = await target.service.recordFeedback(
      target.state.workItem.workItemId,
      {
        expectedRevision: base.workItemRevision,
        feedbackId: 'FDBK-UNAFFECTED',
        suggestionId: unaffected.suggestionId,
        expectedGenerationRevision: 1,
        decision: 'MODIFY',
        note: 'Engineer keeps this independent modification.',
        revisedBodyZh: '工程师保留的未受影响修改。',
        revisedBodyEn: unaffected.bodyEn,
        revisionSourceRefs: unaffected.sourceRefs,
        semanticField: 'BODY',
        reasonCode: 'EXECUTABILITY',
        learningDisposition: 'THIS_DRAFT_ONLY',
      },
      ACTOR,
    );
    const afterAffected = await target.service.recordFeedback(
      target.state.workItem.workItemId,
      {
        expectedRevision: afterUnaffected.workItemRevision,
        feedbackId: 'FDBK-AFFECTED',
        suggestionId: affected.suggestionId,
        expectedGenerationRevision: 1,
        decision: 'MODIFY',
        note: 'This older change must become superseded after regeneration.',
        revisedBodyZh: '将被新一代候选替代的工程师修改。',
        revisedBodyEn: affected.bodyEn,
        revisionSourceRefs: affected.sourceRefs,
        semanticField: 'BODY',
        reasonCode: 'SOURCE_MISMATCH',
        learningDisposition: 'DO_NOT_LEARN',
      },
      ACTOR,
    );
    const nextRequest = target.replaceProducer((producer) => {
      const actions = producer.actions as Array<Record<string, unknown>>;
      actions[1]!.zh = '来自 Host current producer 新 revision 的步骤正文。';
    });
    nextRequest.expectedRevision = afterAffected.workItemRevision;
    const regenerated = await target.service.createDraft(
      target.state.workItem.workItemId,
      nextRequest,
      ACTOR,
    );

    expect(regenerated.generationRevision).toBe(2);
    expect(
      regenerated.suggestions.find(
        (suggestion) => suggestion.sourceUnitId === unaffected.sourceUnitId,
      ),
    ).toEqual(
      expect.objectContaining({
        bodyZh: '工程师保留的未受影响修改。',
        reviewStatus: 'MODIFIED_CANDIDATE',
      }),
    );
    expect(
      regenerated.suggestions.find(
        (suggestion) => suggestion.sourceUnitId === affected.sourceUnitId,
      ),
    ).toEqual(
      expect.objectContaining({
        bodyZh: '来自 Host current producer 新 revision 的步骤正文。',
        reviewStatus: 'PENDING_ENGINEER_REVIEW',
      }),
    );
    expect(regenerated.feedback.map((feedback) => feedback.feedbackId)).toEqual(
      ['FDBK-UNAFFECTED'],
    );
    expect(regenerated.supersededFeedback).toEqual([
      expect.objectContaining({
        feedbackId: 'FDBK-AFFECTED',
        activeThroughGenerationRevision: 1,
        supersededAtGenerationRevision: 2,
      }),
    ]);
    expect(regenerated.projection.doNotLearnFeedbackCount).toBe(0);
    expect(regenerated.adoptionDecisions).toEqual([]);
  });

  it('rejects outsider and stale-revision calls before producer/manifest or persistence I/O', async () => {
    const outsider = harness('AEO-B787-45-0002-R00', true);
    await expect(
      outsider.service.createDraft(
        outsider.state.workItem.workItemId,
        outsider.createRequest(),
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
        {
          ...stale.createRequest(),
          expectedRevision: stale.state.workItem.revision - 1,
        },
        ACTOR,
      ),
    ).rejects.toThrow('WORK_ITEM_CAS_CONFLICT');
    expect(stale.artifacts.readActualBytes).not.toHaveBeenCalled();
    expect(stale.repository.reserveAssessmentAction).not.toHaveBeenCalled();
  });

  it('fails closed when a Host source actual byte identity does not match the manifest', async () => {
    const target = harness('AEO-B747-23-0008-R00');
    const first = [...target.sourceRows.values()][0]!;
    first.bytes[0] = first.bytes[0] === 0 ? 1 : 0;
    await expect(
      target.service.createDraft(
        target.state.workItem.workItemId,
        target.createRequest(),
        ACTOR,
      ),
    ).rejects.toThrow('AEO_EDITING_SOURCE_ACTUAL_BYTES_MISMATCH');
    expect(target.repository.reserveAssessmentAction).not.toHaveBeenCalled();
    expect(target.artifacts.persistAndReadback).not.toHaveBeenCalled();
  });

  it('rejects producer bytes that do not match the Host-owned descriptor', async () => {
    const target = harness('AEO-B787-45-0002-R00');
    const producerRef = target.createRequest().currentProducerArtifact.ref;
    target.byteStore.set(
      producerRef,
      new TextEncoder().encode('{"tampered":true}'),
    );
    await expect(
      target.service.createDraft(
        target.state.workItem.workItemId,
        target.createRequest(),
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
        target.createRequest(),
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

function forbiddenBrowserKeys(value: unknown): string[] {
  const forbidden = new Set([
    'artifactRef',
    'artifactSha256',
    'sourceArtifactRef',
    'sourceSha256',
    'filePath',
    'bucketId',
    'providerObjectId',
    'actorUserId',
    'tenantId',
  ]);
  const found: string[] = [];
  const visit = (input: unknown): void => {
    if (Array.isArray(input)) {
      input.forEach(visit);
      return;
    }
    if (!input || typeof input !== 'object') return;
    Object.entries(input as Record<string, unknown>).forEach(([key, child]) => {
      if (forbidden.has(key)) found.push(key);
      visit(child);
    });
  };
  visit(value);
  return found;
}
