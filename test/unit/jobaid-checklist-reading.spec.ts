import { PgDialect } from 'drizzle-orm/pg-core';
import { buildJobAidChecklistBinding } from '../../server/modules/canonical-host/jobaid-checklist-binding';
import { checklistTaskSelection, currentChecklistDefinition,
  projectTaskChecklist } from '../../server/modules/canonical-host/jobaid-checklist-reading';
import { ReviewAttemptDispatchService, reviewTurnIdempotencyKey } from '../../server/modules/action-attempt/review-attempt-dispatch.service';
import { ACTION_ATTEMPT_REQUEST_ORIGIN } from '../../server/modules/action-attempt/action-attempt.types';
import { fixedModelSettings } from '../support/fixed-model-settings';

const binding = buildJobAidChecklistBinding({ workItemId: 'WI-synthetic', documentVersionId: 'DV-synthetic', basedOnWorkItemRevision: 3 });
const expected = { workItemId: 'WI-synthetic', attemptId: 'ATT-synthetic', taskType: 'OPENCLAW_DYNAMIC_EVALUATION' };
const context = { prepared: true, ...expected, documentVersionId: 'DV-synthetic', binding };

it('preserves the complete sealed definition/selection/acceptance while excluding goal and control context', () => {
  const view = projectTaskChecklist({ ...context, full: { secret: 'synthetic-control-marker' } }, expected);
  expect(view.status).toBe('AVAILABLE');
  expect(view.snapshot).toEqual({ definitionId: binding.definitionId, definitionVersion: binding.definitionVersion,
    definitionContentHash: binding.definitionContentHash, contractVersion: binding.contractVersion,
    definition: binding.definition, selection: binding.selection, acceptance: binding.acceptance });
  expect(view.snapshot!.definition).not.toBe(binding.definition);
  expect(JSON.stringify(view)).not.toMatch(/synthetic-control-marker|WI-synthetic|DV-synthetic|basedOnWorkItemRevision/);
  expect(context.binding).toEqual(binding);
});

it.each([
  [{ prepared: false }, 'NOT_PREPARED'],
  [{ ...context, binding: null }, 'NOT_BOUND'],
  [{ ...context, workItemId: 'WI-other' }, 'INVALID'],
  [{ ...context, attemptId: 'ATT-other' }, 'INVALID'],
  [{ ...context, taskType: 'OPENCLAW_TRANSLATE' }, 'INVALID'],
  [{ ...context, documentVersionId: 'DV-other' }, 'INVALID'],
  [{ ...context, binding: { ...binding, definitionVersion: 'unsupported-definition' } }, 'UNSUPPORTED'],
  [{ ...context, binding: { ...binding, definitionContentHash: 'wrong' } }, 'INVALID'],
  [{ ...context, binding: { ...binding, actor: 'must-not-enter-view' } }, 'INVALID'],
])('does not substitute current definition for unavailable or mismatched sealed data', (input, status) => {
  expect(projectTaskChecklist(input, expected)).toEqual({ status, snapshot: null });
});

it('selects checklist subtrees and association scalars, never a full task, previous body or lease', () => {
  const query = new PgDialect().sqlToQuery(checklistTaskSelection());
  expect(query.sql).toContain("->'jobAidContext'->'previousWork'->'content'->'checklistBinding'");
  expect(query.sql).toContain("->>'reviewTurnRef'");
  expect(query.sql).not.toMatch(/lease_token|actor_user_id|result_envelope_json|->'issues'|->'evidence'/u);
  expect(query.params).toEqual([]);
});

it('describes the current release without claiming an activation, task selection or a write capability', () => {
  const value = currentChecklistDefinition();
  expect(value).toMatchObject({ source: 'HOST_RELEASE', management: 'READ_ONLY_RELEASE_MANAGED' });
  expect(value.current.definition).toEqual(binding.definition);
  expect(value.current).not.toHaveProperty('selection');
  expect(value.current).not.toHaveProperty('goal');
});

it('keeps exact actor/WI/turn checks on the real Review metadata projection and never claims/prepares', async () => {
  const input = { tenantId: 'tenant-synthetic', actorId: 'actor-synthetic', workItemId: expected.workItemId,
    reviewConversationId: 'RC-synthetic', reviewTurnId: 'RT-synthetic', inputRevision: 3,
    executionRequested: true, createdAt: new Date('2026-10-28T00:00:00Z') };
  const row = { tenantId: input.tenantId, actorUserId: input.actorId, workItemId: input.workItemId,
    actionType: 'OPENCLAW_INTERACTIVE_REVIEW', inputRevision: 3, requestOrigin: ACTION_ATTEMPT_REQUEST_ORIGIN,
    status: 'RUNNING', attemptId: expected.attemptId, operationRef: 'AQ-synthetic', updatedAt: input.createdAt,
    checklistContext: { ...context, taskType: 'OPENCLAW_INTERACTIVE_REVIEW',
      reviewTurnRef: input.reviewTurnId, reviewConversationRef: input.reviewConversationId } };
  const repository = { readLatestByExactIdempotency: jest.fn().mockResolvedValue(row), reserve: jest.fn() };
  const lifecycle = { reserveAndClaim: jest.fn() };
  const service = new ReviewAttemptDispatchService(repository as never, lifecycle as never, fixedModelSettings());
  const result = await service.executionProjection(input);
  expect(result?.checklist?.status).toBe('AVAILABLE');
  expect(repository.readLatestByExactIdempotency).toHaveBeenCalledWith({ tenantId: input.tenantId,
    idempotencyKey: reviewTurnIdempotencyKey(input) }, true);
  expect(result).not.toHaveProperty('checklistContext');
  row.checklistContext.reviewTurnRef = 'RT-other';
  expect((await service.executionProjection(input))?.checklist).toEqual({ status: 'INVALID', snapshot: null });
  for (const mismatch of [{ actorId: 'actor-other' }, { workItemId: 'WI-other' }, { tenantId: 'tenant-other' }])
    await expect(service.executionProjection({ ...input, ...mismatch })).rejects.toThrow('REVIEW_EXECUTION_BINDING_MISMATCH');
  expect(repository.reserve).not.toHaveBeenCalled();
  expect(lifecycle.reserveAndClaim).not.toHaveBeenCalled();
});
