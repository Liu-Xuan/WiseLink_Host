import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import test from 'node:test';
import { startCoreP1HostFixture } from './helpers/core-p1-host-postgres.fixture.mjs';

test('P2 preparation fixture uses actual private contribution and Review stores', async () => {
  const f = await startCoreP1HostFixture();
  try {
    const id = 'WI-core-p2-context';
    await f.seed(id);
    const seeded = await f.seedEngineerContribution({
      workItemId: id,
      text: '必须保留温度限制。',
    });
    const rows = await f.hosted(() =>
      f.dialogues.relevantContributions(
        { tenantId: f.tenantId, actorId: f.actorUserId },
        [id],
      ),
    );
    assert.equal(rows.length, 1);
    assert.equal(
      rows[0].contribution_ref,
      seeded.contribution.contribution_ref,
    );
    assert.equal(rows[0].selected_text, '必须保留温度限制。');
    assert.equal(rows[0].consumed_working_ref, null);
    const turn = await f.seedReviewTurn({
      workItemId: id,
      text: '请保留前述更正。',
    });
    assert.equal(turn.userMessage, '请保留前述更正。');
    const queue = await f.nextWorkItem({ resumeWorkItemId: id });
    assert.equal(queue.status, 'CLAIMED');
    const claim = await f.callTool('begin_dynamic_evaluation', {
      workItemId: id,
    });
    assert.equal(claim.task.executionModel.modelRef, 'miaoda/minimax-m3');
    assert.equal(claim.task.executionModel.settingsRevision, 0);
    const saved = await f.callTool('save_assessment_work', {
      workItemId: id,
      attemptRef: claim.attemptRef,
      leaseToken: claim.leaseToken,
      leaseGeneration: claim.leaseGeneration,
      requestId: 'p2-fixture-save',
      expectedWorkRevision: 0,
      workJson: JSON.stringify(f.proposal(claim)),
    });
    assert.equal(saved.workRevision, 1);
    assert.equal((await f.snapshot()).work.length, 1);
    const roles = await f.roleEvidence();
    assert.equal(roles[0].superuser, false);
    assert.equal(roles[0].bypassrls, false);
  } finally {
    await f.close();
  }
});

test('G04: current Host preparation preserves old pending corrections across SAVE/read/session without changing task qualification', async () => {
  const f = await startCoreP1HostFixture();
  try {
    const id = 'WI-core-p2-refresh';
    await f.seed(id);
    const first = await f.seedEngineerContribution({
      workItemId: id,
      text: '不得忽略首次更正。',
    });
    for (let n = 0; n < 15; n++)
      await f.seedReviewTurn({ workItemId: id, text: `未处理输入 ${n}` });
    await f.nextWorkItem({ resumeWorkItemId: id });
    const claim = await f.callTool('begin_dynamic_evaluation', {
      workItemId: id,
    });
    const initial = claim.modelInput.preparation;
    assert.equal(initial.schemaVersion, 'wiselink.jobaid-preparation.v1');
    assert.equal(initial.taskInputRevision, 1);
    assert.equal(initial.currentInputChanged, false);
    assert.equal(initial.pendingEngineerInputs.length, 16);
    assert.ok(
      initial.pendingEngineerInputs.some(
        (input) => input.text === '未处理输入 0',
      ),
    );
    assert.ok(
      initial.pendingEngineerInputs.some(
        (input) => input.ref === first.contribution.contribution_ref,
      ),
    );
    assert.deepEqual(initial.targetIssueKeys, []);
    assert.equal(initial.humanConfirmationStatus, 'NOT_RECORDED');
    assert.deepEqual(initial.humanConfirmedDecisions, []);
    const source = claim.modelInput.availableSources.find(
      (item) => item.kind === 'DOCUMENT_PASSAGE',
    );
    assert.equal(source.documentVersionId, 'dv-job');
    assert.ok(source.sourceRefId);
    assert.equal(source.parseRunId, f.original.binding.parseRunId);
    assert.equal(source.carrierRangeRef, source.ref);
    assert.equal(Object.hasOwn(initial, 'deliveredEvidence'), false);
    const args = {
      workItemId: id,
      attemptRef: claim.attemptRef,
      leaseToken: claim.leaseToken,
      leaseGeneration: claim.leaseGeneration,
      requestId: 'p2-refresh-save',
      expectedWorkRevision: 0,
      workJson: JSON.stringify(f.proposal(claim, 'IN_PROGRESS')),
    };
    const saved = await f.callTool('save_assessment_work', args);
    assert.equal(
      saved.preparation.lastSaved.workRevisionRef,
      saved.workRevisionRef,
    );
    assert.equal(saved.preparation.lastSaved.basedOnInputRevision, 1);
    assert.equal(saved.preparation.currentIssues[0].issueKey, 'condition');
    assert.ok(
      saved.preparation.unfinishedItems.some(
        (item) => item.kind === 'ROUND_IN_PROGRESS',
      ),
    );
    assert.deepEqual(
      saved.preparation.pendingEngineerInputs,
      initial.pendingEngineerInputs,
    );
    const second = await f.seedEngineerContribution({
      workItemId: id,
      text: '新的只读提示仍未并入工作。',
      kind: 'CONSTRAINT',
    });
    const fresh = await f.callTool('read_assessment_work', {
      workItemId: id,
      attemptRef: claim.attemptRef,
    });
    assert.equal(fresh.revision.workRevisionRef, saved.workRevisionRef);
    assert.equal(fresh.preparation.pendingEngineerInputs.length, 17);
    assert.ok(
      fresh.preparation.pendingEngineerInputs.some(
        (input) => input.ref === second.contribution.contribution_ref,
      ),
    );
    const replay = await f.callTool('save_assessment_work', args);
    assert.equal(replay.replayed, true);
    assert.equal(replay.workRevisionRef, saved.workRevisionRef);
    assert.equal(replay.preparation.pendingEngineerInputs.length, 17);
    const session = await f.callTool('begin_dynamic_evaluation', {
      workItemId: id,
    });
    assert.equal(session.task.inputHash, claim.task.inputHash);
    assert.deepEqual(session.modelInput.preparation, initial);
    await f.hosted(() =>
      f.dialogues.withdraw(
        { tenantId: f.tenantId, actorId: f.actorUserId },
        first.thread.thread_ref,
        first.contribution.contribution_ref,
        'withdraw-first',
        1,
      ),
    );
    const withdrawn = await f.callTool('read_assessment_work', {
      workItemId: id,
      attemptRef: claim.attemptRef,
    });
    assert.ok(
      !withdrawn.preparation.pendingEngineerInputs.some(
        (input) => input.ref === first.contribution.contribution_ref,
      ),
    );
    await f.correctInput(id);
    const changed = await f.callTool('read_assessment_work', {
      workItemId: id,
      attemptRef: claim.attemptRef,
      requestId: args.requestId,
    });
    assert.equal(changed.preparation.taskInputRevision, 1);
    assert.equal(changed.preparation.currentInputRevision, 2);
    assert.equal(changed.preparation.currentInputChanged, true);
    assert.equal(
      changed.preparation.lastSaved.workRevisionRef,
      saved.workRevisionRef,
    );
    await assert.rejects(
      f.callTool('save_assessment_work', {
        ...args,
        requestId: 'stale-input',
        expectedWorkRevision: 1,
      }),
      /JOBAID_SAVE_WORK_ITEM_CHANGED/,
    );
    assert.equal((await f.snapshot()).work.length, 1);
  } finally {
    await f.close();
  }
});

test('G04: actual Review APPLIED correction is separate from UNCHANGED and human confirmation', async () => {
  const f = await startCoreP1HostFixture();
  try {
    const id = 'WI-core-p2-review-receipts';
    await f.seed(id);
    await f.nextWorkItem({ resumeWorkItemId: id });
    const initial = await f.callTool('begin_dynamic_evaluation', {
      workItemId: id,
    });
    const saved = await f.callTool('save_assessment_work', {
      workItemId: id,
      attemptRef: initial.attemptRef,
      leaseToken: initial.leaseToken,
      leaseGeneration: initial.leaseGeneration,
      requestId: 'review-original-save',
      expectedWorkRevision: 0,
      workJson: JSON.stringify(f.proposal(initial)),
    });
    await f.callTool('commit_dynamic_evaluation_candidate', {
      workItemId: id,
      attemptRef: initial.attemptRef,
      leaseToken: initial.leaseToken,
      leaseGeneration: initial.leaseGeneration,
      result: f.result(initial, saved.workRevisionRef),
    });
    const { createRequire } = await import('node:module');
    const require = createRequire(import.meta.url);
    const {
      sealResultEnvelope,
    } = require('../../server/modules/action-attempt/action-attempt-envelope.ts');
    const unselected = await f.seedEngineerContribution({
      workItemId: id,
      text: '未选取的个人输入不应进入本Review。',
    });
    await f.seedReviewTurn({
      workItemId: id,
      text: '未选取的讨论仍单独保留。',
    });
    const apply = await f.seedReviewTurn({
      workItemId: id,
      text: '保留温度限制并修正此问题。',
      purpose: 'UPDATE_ASSESSMENT',
      targetIssueKeys: ['condition'],
    });
    async function commitTurn(turn, withDelta) {
      return f.withReviewScope(id, async (service) => {
        const claim = await service.begin(
          turn.reviewConversationId,
          turn.requestId,
          id,
        );
        const task = claim.task.modelInput;
        const source = task.jobAidContext.sourceCatalog.find(
          (item) => item.kind === 'DOCUMENT_PASSAGE',
        );
        await service.readSourceRefs(
          claim.attemptRef,
          [source.evidenceRef],
          id,
        );
        const delta = withDelta
          ? f.proposal({ task: { modelInput: task.jobAidContext } })
          : null;
        if (delta) {
          delta.issues[0].body = `温度限制尚未核实，保留准确原文的条件。 [[${source.evidenceRef}]]`;
          delta.changeSummary = '按本轮工程师输入保留温度限制。';
        }
        const candidate = {
          schemaVersion: 'wiselink.3_1.review_turn_candidate.v1.c5',
          mode: 'INTERACTIVE_REVIEW',
          reviewConversationRef: turn.reviewConversationId,
          reviewTurnRef: turn.reviewTurnId,
          responseType: 'ANSWER',
          answer: withDelta
            ? '已保存候选更正，尚未人工确认。'
            : '当前工作无需改变。',
          sourceRefs: [source.evidenceRef],
          missingInputs: [],
          candidateEvidenceRefs: [],
          reviewActionDraft: null,
          affectedItemIds: [],
          warnings: [],
          jobAidWorkingDelta: delta,
          runtime: {
            runtimeAppId: 'app_17c3zn24kv2',
            profileRef: 'wiselink-engineering',
          },
        };
        const { contentHash: _, ...base } = f.result(
          claim,
          saved.workRevisionRef,
        );
        const result = sealResultEnvelope({
          ...base,
          modelOutput: JSON.stringify(candidate),
          promptVersion: 'constructed-review@v1',
        });
        const receipt = await service.commit(
          claim.attemptRef,
          claim.leaseToken,
          claim.leaseGeneration,
          result,
          id,
        );
        return { claim, receipt };
      });
    }
    const applied = await commitTurn(apply, true);
    assert.equal(applied.receipt.status, 'SUCCEEDED');
    const selectedPreparation =
      applied.claim.task.modelInput.jobAidContext.modelInput.preparation;
    assert.ok(
      !selectedPreparation.pendingEngineerInputs.some(
        (input) => input.ref === unselected.contribution.contribution_ref,
      ),
    );
    assert.ok(
      !selectedPreparation.pendingEngineerInputs.some(
        (input) => input.text === '未选取的讨论仍单独保留。',
      ),
    );

    const update = applied.receipt.assistantCandidate.jobAidWorkingUpdate;
    assert.equal(update.status, 'APPLIED');
    assert.equal(update.workRevision, 2);
    assert.notEqual(update.workRevisionRef, saved.workRevisionRef);
    assert.equal(
      applied.claim.task.modelInput.jobAidContext.modelInput.preparation.goal,
      apply.userMessage,
    );
    assert.deepEqual(
      applied.claim.task.modelInput.jobAidContext.modelInput.preparation
        .targetIssueKeys,
      ['condition'],
    );
    const unchangedTurn = await f.seedReviewTurn({
      workItemId: id,
      text: '复核后保持当前认识。',
      purpose: null,
    });
    const unchanged = await commitTurn(unchangedTurn, false);
    assert.equal(
      unchanged.receipt.assistantCandidate.jobAidWorkingUpdate.status,
      'UNCHANGED',
    );
    assert.equal(
      unchanged.receipt.assistantCandidate.jobAidWorkingUpdate.workRevisionRef,
      update.workRevisionRef,
    );
    const fresh = await f.callTool('read_assessment_work', {
      workItemId: id,
      attemptRef: initial.attemptRef,
    });
    assert.equal(
      fresh.preparation.lastSaved.workRevisionRef,
      update.workRevisionRef,
    );
    assert.ok(
      fresh.preparation.savedUpdates.some(
        (item) =>
          item.status === 'APPLIED' &&
          item.workRevisionRef === update.workRevisionRef,
      ),
    );
    assert.ok(
      fresh.preparation.savedUpdates.some(
        (item) =>
          item.status === 'UNCHANGED' &&
          item.workRevisionRef === update.workRevisionRef,
      ),
    );
    assert.equal(
      fresh.preparation.pendingEngineerInputs.some(
        (item) => item.ref === apply.engineerSuppliedInputId,
      ),
      false,
    );
    assert.deepEqual(fresh.preparation.humanConfirmedDecisions, []);
    assert.equal(fresh.preparation.humanConfirmationStatus, 'NOT_RECORDED');
    const snapshot = await f.snapshot();
    assert.equal(snapshot.work.length, 2);
    assert.equal(
      snapshot.work.find((row) => row.work_revision === 2).action_attempt_id,
      applied.claim.task.actionAttemptId,
    );
  } finally {
    await f.close();
  }
});

for (const change of ['input', 'work', 'source']) {
  test(`G04 SAVE transaction rechecks ${change} after preparation returned`, async (t) => {
    const f = await startCoreP1HostFixture();
    try {
      const id = `WI-core-p2-save-race-${change}`;
      await f.seed(id);
      assert.equal(
        (await f.nextWorkItem({ resumeWorkItemId: id })).status,
        'CLAIMED',
      );
      const claim = await f.callTool('begin_dynamic_evaluation', {
        workItemId: id,
      });
      const args = {
        workItemId: id,
        attemptRef: claim.attemptRef,
        leaseToken: claim.leaseToken,
        leaseGeneration: claim.leaseGeneration,
        requestId: 'save-before-preparation-race',
        expectedWorkRevision: 0,
        workJson: JSON.stringify(f.proposal(claim, 'IN_PROGRESS')),
      };
      const original = await f.callTool('save_assessment_work', args);
      const before = await f.snapshot();
      assert.equal(before.work.length, 1);
      const originalRow = before.work[0];
      const proposal = f.proposal(claim, 'IN_PROGRESS');
      proposal.issues[0].body = `继续核查该条件。 ${proposal.issues[0].body}`;
      proposal.changeSummary = '继续核查已保存的问题。';
      let viewBeforeChange;
      let interleaved;
      let pendingAfterChange;
      let winner;
      f.armPreparationReadHook(async (view) => {
        viewBeforeChange = view;
        assert.equal(view.taskInputRevision, 1);
        assert.equal(view.currentInputRevision, 1);
        assert.equal(view.currentInputChanged, false);
        assert.equal(view.documentVersionId, 'dv-job');
        assert.equal(view.lastSaved.workRevisionRef, original.workRevisionRef);
        assert.equal(view.lastSaved.workRevision, 1);
        assert.equal(view.lastSaved.basedOnInputRevision, 1);
        if (change === 'input') await f.correctInput(id);
        if (change === 'source') await f.correctSource(id);
        if (change === 'work') {
          const competing = structuredClone(proposal);
          competing.issues[0].body = `另一合法保存已先提交。 ${competing.issues[0].body}`;
          competing.changeSummary = '另一合法保存先完成。';
          winner = await f.callTool('save_assessment_work', {
            ...args,
            requestId: 'save-winning-work-race',
            expectedWorkRevision: 1,
            workJson: JSON.stringify(competing),
          });
          assert.equal(winner.workRevision, 2);
          assert.equal(winner.replayed, false);
        }
        interleaved = await f.snapshot();
        pendingAfterChange = await f.sql`
          SELECT * FROM engineering_search_projection_pending ORDER BY id`;
      });
      const expectedCode = {
        input: 'JOBAID_SAVE_WORK_ITEM_CHANGED',
        work: 'JOBAID_WORK_REVISION_CONFLICT',
        source: 'JOBAID_SOURCE_VERSION_CHANGED',
      }[change];
      await assert.rejects(
        f.callTool('save_assessment_work', {
          ...args,
          requestId: 'save-stale-preparation-race',
          expectedWorkRevision: 1,
          workJson: JSON.stringify(proposal),
        }),
        (error) => error.message === expectedCode,
      );
      assert.ok(viewBeforeChange);
      const after = await f.snapshot();
      assert.deepEqual(
        after,
        interleaved,
        'rejected SAVE must not alter the committed state',
      );
      assert.deepEqual(
        await f.sql`SELECT * FROM engineering_search_projection_pending ORDER BY id`,
        pendingAfterChange,
      );
      assert.deepEqual(
        after.work[0],
        originalRow,
        'original SAVE remains byte-for-byte unchanged',
      );
      assert.deepEqual(after.attempts, before.attempts);
      assert.deepEqual(after.grants, before.grants);
      assert.equal(after.work.length, change === 'work' ? 2 : 1);
      assert.equal(
        after.work.some(
          (row) => row.request_id === 'save-stale-preparation-race',
        ),
        false,
      );
      const current = after.workItems.find((row) => row.work_item_id === id);
      const previous = before.workItems.find((row) => row.work_item_id === id);
      const currentSource = JSON.parse(current.projection_json).source;
      const previousSource = JSON.parse(previous.projection_json).source;
      assert.equal(current.revision, change === 'work' ? 1 : 2);
      assert.equal(
        currentSource.sourceFileSha256,
        change === 'source' ? 'c'.repeat(64) : previousSource.sourceFileSha256,
      );
      assert.equal(current.document_version_id, previous.document_version_id);
      assert.equal(current.source_file_sha256, previous.source_file_sha256);
      if (change === 'work') {
        assert.equal(
          after.work[1].assessment_work_revision_id,
          winner.workRevisionRef,
        );
        assert.equal(
          after.work[1].previous_work_revision_id,
          original.workRevisionRef,
        );
        assert.equal(after.work[1].based_on_work_item_revision, 1);
        const latest = await f.callTool('read_assessment_work', {
          workItemId: id,
          attemptRef: claim.attemptRef,
        });
        assert.equal(latest.revision.workRevisionRef, winner.workRevisionRef);
        assert.equal(
          latest.preparation.lastSaved.workRevisionRef,
          winner.workRevisionRef,
        );
      }
      if (change !== 'source') {
        const readback = await f.callTool('read_assessment_work', {
          workItemId: id,
          attemptRef: claim.attemptRef,
          requestId: args.requestId,
        });
        assert.equal(
          readback.revision.workRevisionRef,
          original.workRevisionRef,
        );
        assert.equal(
          readback.preparation.currentInputChanged,
          change === 'input',
        );
      }
      const roles = await f.roleEvidence();
      assert.equal(roles[0].superuser, false);
      assert.equal(roles[0].bypassrls, false);
      assert.notEqual(roles[0].current_user, roles[0].table_owner);
      assert.notEqual(roles[0].session_user, roles[0].table_owner);
      t.diagnostic(
        JSON.stringify({
          change,
          expectedCode,
          observedView: {
            taskInputRevision: viewBeforeChange.taskInputRevision,
            currentInputRevision: viewBeforeChange.currentInputRevision,
            currentInputChanged: viewBeforeChange.currentInputChanged,
            lastSaved: viewBeforeChange.lastSaved,
          },
          actualInputRevision: current.revision,
          projectedSourceChanged:
            currentSource.sourceFileSha256 !== previousSource.sourceFileSha256,
          originalSourceColumnsPreserved: true,
          workRevisions: after.work.map((row) => row.work_revision),
          originalPreserved: true,
          failedSaveAddedNoRows: true,
          roles,
          ownership: f.ownership,
        }),
      );
    } finally {
      await f.close();
      await assert.rejects(access(f.ownership.root), { code: 'ENOENT' });
      t.diagnostic(JSON.stringify({ ownedPostgresRemoved: f.ownership.root }));
    }
  });
}

test('C309 repository: unchanged validates the existing actor transaction without writes', async (t) => {
  const f = await startCoreP1HostFixture();
  const cases = [
    ['RUNNING baseline', null],
    ['COMMITTING baseline', null],
    ['foreign tenant', 'JOBAID_ACTOR_AUTHORIZATION_CHANGED'],
    ['different task hash', 'JOBAID_SAVE_ATTEMPT_CHANGED'],
    ['new current input', 'JOBAID_SAVE_WORK_ITEM_CHANGED'],
    ['new current work', 'JOBAID_WORK_REVISION_CONFLICT'],
    ['changed source', 'JOBAID_SOURCE_VERSION_CHANGED'],
    ['expired lease', 'JOBAID_WORK_LEASE_FENCE_REJECTED'],
    ['revoked actor', 'JOBAID_ACTOR_AUTHORIZATION_CHANGED'],
  ];
  try {
    const roles = await f.roleEvidence();
    assert.equal(roles[0].superuser, false);
    assert.equal(roles[0].bypassrls, false);
    assert.notEqual(roles[0].current_user, roles[0].table_owner);
    assert.notEqual(roles[0].session_user, roles[0].table_owner);
    for (const [index, [scenario, errorCode]] of cases.entries()) {
      await t.test(scenario, async () => {
        const id = `WI-c309-repository-${index}`;
        await f.seed(id, {
          executionModel: {
            modelRef: 'miaoda/glm-5.3',
            displayName: 'GLM-5.3',
            providerKind: 'BUILT_IN',
            settingsRevision: 1,
            selectedAt: '2026-10-16T00:00:00.000Z',
          },
        });
        const initial = await f.withReviewScope(id, () =>
          f.callTool('begin_dynamic_evaluation', { workItemId: id }),
        );
        const proposal = f.proposal(initial, 'COMPLETE_WITH_OPEN_QUESTIONS');
        proposal.issues[0].openQuestions = [
          {
            question: '构型证据仍未核实。',
            affects: '条件适用范围',
            nextEvidence: '受控构型材料',
            reason: '本机合成材料没有构型证明。',
          },
        ];
        const saved = await f.withReviewScope(id, () =>
          f.callTool('save_assessment_work', {
            workItemId: id,
            attemptRef: initial.attemptRef,
            leaseToken: initial.leaseToken,
            leaseGeneration: initial.leaseGeneration,
            requestId: `c309-original-${index}`,
            expectedWorkRevision: 0,
            workJson: JSON.stringify(proposal),
          }),
        );
        await f.withReviewScope(id, () =>
          f.callTool('commit_dynamic_evaluation_candidate', {
            workItemId: id,
            attemptRef: initial.attemptRef,
            leaseToken: initial.leaseToken,
            leaseGeneration: initial.leaseGeneration,
            result: f.result(initial, saved.workRevisionRef),
          }),
        );
        if (scenario === 'RUNNING baseline') {
          const overall = await f.withReviewScope(id, () =>
            f.callTool('begin_overall_synthesis', { workItemId: id }),
          );
          await f.withReviewScope(id, () =>
            f.callTool('commit_overall_candidate', {
              workItemId: id,
              attemptRef: overall.attemptRef,
              leaseToken: overall.leaseToken,
              leaseGeneration: overall.leaseGeneration,
              result: f.result(
                overall,
                saved.workRevisionRef,
                '保留原构型未知，不形成正式采用。',
              ),
            }),
          );
        }
        const turn = await f.seedReviewTurn({
          workItemId: id,
          text: '仅比较现有材料，不得清除构型未知。',
          purpose: 'UPDATE_ASSESSMENT',
        });
        const claim = await f.withReviewScope(id, (service) =>
          service.begin(turn.reviewConversationId, turn.requestId, id),
        );
        const task = claim.task.modelInput.jobAidContext;
        const row = await f.hosted(() =>
          f.attempts.readScoped({
            attemptRef: claim.attemptRef,
            tenantId: f.tenantId,
            workItemId: id,
          }),
        );
        const fence = {
          principalId: row.leaseOwner,
          leaseToken: claim.leaseToken,
          leaseGeneration: claim.leaseGeneration,
        };
        const input = { row, task, fence };
        if (scenario === 'COMMITTING baseline') {
          // Real lifecycle cutoff with a synthetic sealed model result, not a
          // persisted Review receipt or an UPDATE_ASSESSMENT acceptance claim.
          await f.hosted(() =>
            f.attempts.prepareCommit({
              attemptRef: claim.attemptRef,
              tenantId: f.tenantId,
              workItemId: id,
              ...fence,
              result: f.result(claim, saved.workRevisionRef),
              failClosedWithoutRejectionMutation: true,
            }),
          );
        }
        if (scenario === 'foreign tenant')
          input.row = { ...row, tenantId: 'foreign' };
        if (scenario === 'different task hash')
          input.row = { ...row, taskInputHash: 'b'.repeat(64) };
        if (scenario === 'new current input') await f.correctInput(id);
        if (scenario === 'changed source') await f.correctSource(id);
        if (scenario === 'new current work') {
          const source = task.sourceCatalog.find(
            (item) => item.kind === 'DOCUMENT_PASSAGE',
          );
          await f.withReviewScope(id, (service) =>
            service.readSourceRefs(claim.attemptRef, [source.evidenceRef], id),
          );
          const competing = f.proposal(
            { task: { modelInput: task } },
            'COMPLETE_WITH_OPEN_QUESTIONS',
          );
          competing.issues[0].body += ' 另一合法保存补充了条件说明。';
          competing.issues[0].openQuestions = proposal.issues[0].openQuestions;
          competing.changeSummary = '另一合法工作先完成保存。';
          await f.hosted(() =>
            f.work.withActorTransaction(f.actorUserId, (database) =>
              f.problem.saveReviewWork(
                {
                  row,
                  task,
                  fence,
                  requestId: 'c309-competing-work',
                  proposal: competing,
                  actualReadRefs: new Set([source.evidenceRef]),
                },
                database,
              ),
            ),
          );
        }
        if (scenario === 'expired lease') {
          const expires = new Date(row.leaseExpiresAt).getTime();
          await f.advance(expires - Date.now() + 1);
          assert.ok(new Date(row.deadlineAt).getTime() > Date.now());
        }
        if (scenario === 'revoked actor') await f.revokeActor();
        const before = await f.snapshot();
        const projections =
          await f.sql`SELECT * FROM engineering_search_projection_pending ORDER BY id`;
        const original = before.work.find(
          (work) => work.assessment_work_revision_id === saved.workRevisionRef,
        );
        assert.ok(original);
        const validate = () =>
          f.hosted(() =>
            f.work.withActorTransaction(f.actorUserId, (database) =>
              f.problem.assertReviewWorkUnchanged(input, database),
            ),
          );
        if (errorCode) {
          await assert.rejects(
            validate(),
            (error) => error.message === errorCode,
          );
        } else {
          const actual = await validate();
          assert.equal(
            actual.workRevisionRef,
            original.assessment_work_revision_id,
          );
          assert.equal(actual.workRevision, original.work_revision);
          assert.equal(actual.actionAttemptId, original.action_attempt_id);
          assert.equal(
            actual.basedOnWorkItemRevision,
            original.based_on_work_item_revision,
          );
          assert.equal(JSON.stringify(actual.content), original.content_json);
          assert.deepEqual(
            actual.content.issues[0].openQuestions,
            proposal.issues[0].openQuestions,
          );
          assert.equal(
            actual.content.roundCompletion,
            'COMPLETE_WITH_OPEN_QUESTIONS',
          );
          assert.notEqual(actual.actionAttemptId, row.attemptId);
          assert.notEqual(actual.basedOnWorkItemRevision, row.inputRevision);
        }
        const after = await f.snapshot();
        assert.deepEqual(
          after,
          before,
          'UNCHANGED validation must not mutate any saved state',
        );
        assert.deepEqual(
          await f.sql`SELECT * FROM engineering_search_projection_pending ORDER BY id`,
          projections,
        );
        assert.equal(
          after.work.some((work) => work.action_attempt_id === row.attemptId),
          scenario === 'new current work',
        );
        if (scenario === 'RUNNING baseline') {
          const item = before.workItems.find(
            (work) => work.work_item_id === id,
          );
          const overall = JSON.parse(item.projection_json).integratedAssessment
            .overallSynthesis;
          assert.equal(overall.status, 'CANDIDATE_ONLY');
          assert.equal(
            overall.basedOnJobAidWorkRevisionRef,
            saved.workRevisionRef,
          );
        }
        t.diagnostic(
          JSON.stringify({
            scenario,
            errorCode,
            workItemId: id,
            attemptRef: claim.attemptRef,
            taskInputHash: row.taskInputHash,
            inputRevision: row.inputRevision,
            previousWork: {
              ref: original.assessment_work_revision_id,
              revision: original.work_revision,
              basedOnInputRevision: original.based_on_work_item_revision,
            },
            storedAttemptStatus: before.attempts.find(
              (attempt) => attempt.attempt_id === row.attemptId,
            ).status,
            leaseGeneration: claim.leaseGeneration,
            unchangedState: true,
            repositoryOnly: true,
            formalReviewReceiptPersisted: false,
          }),
        );
      });
    }
    t.diagnostic(JSON.stringify({ roles, ownership: f.ownership }));
  } finally {
    const ownership = f.ownership;
    await f.close();
    await assert.rejects(access(ownership.root), { code: 'ENOENT' });
    t.diagnostic(JSON.stringify({ ownedPostgresRemoved: ownership.root }));
  }
});
