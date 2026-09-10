import type { EngineeringMatterWorkspaceRead } from '@client/src/api/engineering-matter';
import type { EngineeringMatterDirectoryResponse } from '@shared/api.interface';

/** Isolated UI test fixture, never imported by the product. */
export function libraryMatterFixture(): EngineeringMatterWorkspaceRead {
  return {
    matter: {
      schemaVersion: 'wiselink.3_1.engineering_matter_catalog.v1',
      matterId: 'ui-test-matter',
      title: '测试事项：软件标准转换与一致性核查',
      status: 'ACTIVE',
      currentRevision: {
        matterRevisionId: 'test-mr-2',
        revisionNo: 2,
        changeKind: 'CREATED',
        changeSummary: '测试资料登记',
        createdAt: '2026-09-10T01:00:00Z',
      },
      catalog: { scope: 'CROSS_WORK_ITEM', entries: [] },
      authorization: {
        policy: 'ALL_LINKED_WORK_ITEMS_REQUIRED',
        authorizedWorkItemCount: 1,
      },
      authority: {
        workItemCurrentRemainsAuthoritative: true,
        documentManagementRemainsAuthoritative: true,
        sourceRefsRemainWorkItemScoped: true,
        matterCreatesAssessmentCurrent: false,
      },
    },
    working: {
      matterId: 'ui-test-matter',
      currentMatterRevisionId: 'test-mr-2',
      currentWorkingRevision: 3,
      pendingInputs: [],
      current: {
        matterWorkRevisionId: 'test-working-3',
        matterId: 'ui-test-matter',
        workingRevision: 3,
        basedOnMatterRevisionId: 'test-mr-2',
        updateKind: 'INITIAL_SYNTHESIS',
        changeSummary: '已保存局部认识，构型条件仍需核查。',
        substantiveResultRef: 'test-saved-result',
        substantiveResultRevision: 3,
        state: {
          schemaVersion: 'wiselink.3_1.engineering_matter_working_state.v1',
          focus: {
            question: '软件标准变化是否影响现有一致性检查？',
            targetRefs: [],
          },
          substantiveResult: {
            resultRef: 'test-saved-result',
            resultRevision: 3,
            scope: { kind: 'ENGINEERING_MATTER', matterId: 'ui-test-matter' },
            candidateOnly: true,
            evidence: [],
            content: {
              schemaVersion: 'wiselink.3_1.assessment_reading.v1',
              headline: '措施与条件 X 相关，目标构型仍需核查',
              listBrief:
                '已保存的认识限定在条件 X；没有证据说明可直接推广到条件 Y。',
              lead: '背景材料帮助理解标准变化，但我方目标构型记录尚未核实。不能由资料要求推断已经实施。',
              claims: [
                {
                  claimId: 'test-claim',
                  text: '当前资料不足以证明本机队已经实施或不存在故障。',
                  basis: 'CONDITIONAL_INFERENCE',
                  premises: [],
                },
              ],
              decisiveClaimIds: ['test-claim'],
            },
          },
          openQuestions: [
            { itemId: 'q1', text: '核对目标飞机实际软件标准。', basisRefs: [] },
          ],
          reviewConditions: [
            {
              itemId: 'r1',
              text: '新修订或构型记录到达后重新核对。',
              basisRefs: [],
            },
          ],
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
        createdAt: '2026-09-10T01:00:00Z',
      },
    },
  };
}

export function libraryMatterRows(): EngineeringMatterDirectoryResponse['items'] {
  const data = libraryMatterFixture();
  const result = data.working.current!.state.substantiveResult!;
  return [
    {
      matterId: data.matter.matterId,
      title: data.matter.title,
      primaryWorkItemId: 'test-wi',
      createdAt: '2026-09-10T01:00:00Z',
      updatedAt: '2026-09-10T01:00:00Z',
      currentMatterRevisionId: 'test-mr-2',
      workingRevision: 3,
      result: {
        resultRef: result.resultRef,
        resultRevision: result.resultRevision,
        headline: result.content.headline,
        listBrief: result.content.listBrief,
        decisiveClaims: result.content.claims.map(({ claimId, text }) => ({
          claimId,
          text,
        })),
      },
    },
  ];
}
