import { DialogueContextService } from '../../server/modules/canonical-host/dialogue-context.service';
import type {
  DialogueRepository,
  DialogueMessageRow,
} from '../../server/modules/canonical-host/dialogue.repository';
import type { CanonicalJobAidProblemService } from '../../server/modules/canonical-host/canonical-jobaid-problem.service';
import type { CanonicalObjectAccessPort } from '../../server/modules/work-item/canonical-object-access.port';
import type { ResolvedSession } from '../../server/modules/identity/session-resolver.service';
import type { DialogueWorkingContext } from '../../shared/dialogue.interface';

describe('dialogue context interaction', () => {
  const session = {
    actor: {
      tenantId: 'tenant',
      canonicalSubject: { id: 'alice' },
      platformRoles: [],
      applicationScopeId: 'app',
      env: 'dev',
    },
  } as unknown as ResolvedSession;
  const focus: DialogueWorkingContext = {
    workItemId: 'A',
    documentVersionId: 'R1',
    workItemRevision: 7,
    workingRef: 'W4',
    workingRevision: 4,
    documentLabel: 'test A',
    readAt: '2026-09-10T12:00:00Z',
    assessmentAsOf: '2026-09-10T11:00:00Z',
    summary: '新的工作认识仍需工程师核对',
    projection: 'CURRENT_WORKING_SUMMARY',
    openQuestions: [],
    pendingContributions: [],
  };
  function harness() {
    const freshRead = jest.fn();
    const readBrowser = jest.fn();
    const relevantContributions = jest.fn().mockResolvedValue([]);
    const contributionContext = jest.fn().mockResolvedValue([]);
    const service = new DialogueContextService(
      { freshRead } as unknown as CanonicalObjectAccessPort,
      { readBrowser } as unknown as CanonicalJobAidProblemService,
      {
        relevantContributions,
        contributionContext,
      } as unknown as DialogueRepository,
    );
    return {
      service,
      freshRead,
      readBrowser,
      relevantContributions,
      contributionContext,
    };
  }

  it('denies an unauthorized object before loading its working context or contributions', async () => {
    const h = harness();
    h.freshRead.mockResolvedValue({ allowed: false, code: 'DENIED' });
    await expect(h.service.current(session, ['private-B'])).rejects.toThrow(
      'DENIED',
    );
    expect(h.readBrowser).not.toHaveBeenCalled();
    expect(h.relevantContributions).not.toHaveBeenCalled();
  });

  it('rejects an allowed grant for a different actor instead of trusting its object contents', async () => {
    const h = harness();
    h.freshRead.mockResolvedValue({
      allowed: true,
      tenantId: 'tenant',
      actorUserId: 'bob',
      workItemId: 'A',
      action: 'READ_WORK_ITEM',
    });
    await expect(h.service.current(session, ['A'])).rejects.toThrow(
      'DIALOGUE_OBJECT_ACCESS_INVALID',
    );
    expect(h.readBrowser).not.toHaveBeenCalled();
  });

  it('places the current W4 in currentWorking and keeps a historical W3 answer attributable', () => {
    const { service } = harness();
    const history = [
      {
        message_ref: 'M1',
        user_text: '解释 W3',
        query_status: 'COMPLETED',
        answer_text: '我依据的是旧 W3',
        focus_json: '[]',
        context_json: '{}',
      },
    ] as DialogueMessageRow[];
    const result = service.generation('依据新工作稿继续', [focus], history);
    const payload = JSON.parse(result.generationQuery.split('\n').at(-1)!);
    expect(payload.currentWorking[0].workingRef).toBe('W4');
    expect(payload.recentDialogue[0].assistant).toBe('我依据的是旧 W3');
    expect(result.historyMessageRefs).toEqual(['M1']);
  });

  it('does not present partial or failed answers as completed dialogue context', () => {
    const { service } = harness();
    const result = service.generation('继续', [], [
      {
        message_ref: 'M1',
        user_text: '前问',
        query_status: 'UNKNOWN',
        answer_text: '未确认的前缀',
        focus_json: '[]',
        context_json: '{}',
      },
    ] as DialogueMessageRow[]);
    const payload = JSON.parse(result.generationQuery.split('\n').at(-1)!);
    expect(payload.recentDialogue[0].assistant).toBeNull();
    expect(result.generationQuery).not.toContain('未确认的前缀');
  });

  it('keeps a long conversation within the actual Aily input limit and reports omitted history', () => {
    const { service } = harness();
    const history = Array.from({ length: 12 }, (_, index) => ({
      message_ref: `M${index}`,
      user_text: '问'.repeat(3500),
      query_status: 'COMPLETED',
      answer_text: '答'.repeat(20000),
      focus_json: '[]',
      context_json: '{}',
    })) as DialogueMessageRow[];
    const result = service.generation('请接续最新工作稿', [focus], history);
    expect(result.generationQuery.length).toBeLessThanOrEqual(60_000);
    expect(result.earlierMessagesOmitted).toBe(true);
    const payload = JSON.parse(result.generationQuery.split('\n').at(-1)!);
    expect(payload.userMessage).toBe('请接续最新工作稿');
    expect(payload.currentWorking[0].workingRef).toBe('W4');
  });

  it('keeps the preceding question with an affirmative contribution instead of turning it into an isolated fact', async () => {
    const h = harness();
    h.freshRead.mockResolvedValue({
      allowed: true,
      tenantId: 'tenant',
      actorUserId: 'alice',
      workItemId: 'A',
      action: 'READ_WORK_ITEM',
      documentVersionId: 'R1',
      workItemRevision: 7,
    });
    h.readBrowser.mockResolvedValue({
      current: {
        workRevisionRef: 'W4',
        workRevision: 4,
        createdAt: focus.assessmentAsOf,
        content: {
          headline: '工作稿',
          understanding: '尚未正式采用',
          issues: [],
        },
      },
    });
    h.relevantContributions.mockResolvedValue([
      {
        contribution_ref: 'C1',
        work_item_id: 'A',
        kind: 'HYPOTHESIS',
        selected_text: '是的',
      },
    ]);
    h.contributionContext.mockResolvedValue([
      {
        message_ref: 'M1',
        user_text: 'Win10 的条件',
        query_status: 'COMPLETED',
        answer_text: 'Win10 仅为测试假设吗？',
        focus_json: '["A"]',
        context_json: '{}',
      },
      {
        message_ref: 'M2',
        user_text: '是的',
        query_status: null,
        answer_text: null,
        focus_json: '["A"]',
        context_json: '{}',
      },
    ]);
    const current = await h.service.current(session, ['A']);
    expect(current[0].pendingContributions[0]).toMatchObject({
      selectedText: '是的',
      sourceContext: [
        expect.objectContaining({ assistantText: 'Win10 仅为测试假设吗？' }),
        expect.objectContaining({ userText: '是的' }),
      ],
    });
    const generation = h.service.generation('继续解释', current, []);
    expect(generation.generationQuery).toContain('Win10 仅为测试假设吗？');
    expect(generation.contextWorkItemIds).toEqual(['A']);
  });

  it('rechecks inherited permissions in a contribution before reading the working result', async () => {
    const h = harness();
    h.freshRead.mockImplementation(async ({ accessRoot }) =>
      accessRoot.id === 'B'
        ? { allowed: false, code: 'REVOKED_B' }
        : {
            allowed: true,
            tenantId: 'tenant',
            actorUserId: 'alice',
            workItemId: 'A',
            action: 'READ_WORK_ITEM',
          },
    );
    h.relevantContributions.mockResolvedValue([
      {
        contribution_ref: 'C1',
        work_item_id: 'A',
        kind: 'HYPOTHESIS',
        selected_text: '引自旧上下文',
      },
    ]);
    h.contributionContext.mockResolvedValue([
      {
        message_ref: 'M2',
        user_text: '原话',
        focus_json: '["A"]',
        context_json: '{"contextWorkItemIds":["B"]}',
      },
    ]);
    await expect(h.service.current(session, ['A'])).rejects.toThrow(
      'REVOKED_B',
    );
    expect(h.readBrowser).not.toHaveBeenCalled();
  });
});
