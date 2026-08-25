import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(__dirname, '../..');

describe('single canonical app workspace', () => {
  it('absorbs the workbench and document tree without reviving module apps', async () => {
    const [routes, layout, page, tree, dock, trail] = await Promise.all([
      source('client/src/app.tsx'),
      source('client/src/components/Layout.tsx'),
      source('client/src/pages/DocumentParsingPage/DocumentParsingPage.tsx'),
      source('client/src/pages/DocumentParsingPage/WorkItemContextTree.tsx'),
      source('client/src/pages/DocumentParsingPage/WorkItemContextDock.tsx'),
      source(
        'client/src/pages/DocumentParsingPage/EngineeringReasoningTrail.tsx',
      ),
    ]);

    expect(routes).toContain('WorkspaceHomePage');
    expect(routes).toContain('work-items/:workItemId/documents');
    expect(routes).not.toContain('ailyCardsPreviewRoute');
    expect(routes).not.toContain('AilyCardsPreview');
    expect(routes).not.toContain('mockFixtures');
    expect(layout).toContain('WiseLink 主导航');
    expect(layout).toContain('AI 初步意见需复核');
    expect(layout).not.toContain('唯一妙搭应用');
    expect(layout).not.toContain('CANONICAL HOST');
    expect(page).toContain('WorkbenchShell');
    expect(page).toContain('WorkItemContextTree');
    expect(page).toContain('EvidencePanel');
    expect(tree).toContain('族群 · 文档 · 修订');
    expect(tree).toContain('随当前工程事项的最新资料更新');
    expect(dock).toContain('动态评估');
    expect(dock).toContain('运行与版本详情');
    expect(dock).toContain('人工确认边界');
    expect(trail).toContain('方法、依据、缺口与人工动作');
    expect(trail).toContain('不把模型不可审计的隐式思维草稿当作依据');
    expect(page).toContain('查看评估过程与版本详情');
    expect(page).toContain('sourceBoundCandidateCount');
    expect(page).toContain('externalDiscoveryIsEvidence');
  });

  it('keeps model execution out of the browser workbench', async () => {
    const [page, api] = await Promise.all([
      source('client/src/pages/DocumentParsingPage/DocumentParsingPage.tsx'),
      source('client/src/api/canonical-host.ts'),
    ]);

    expect(page).not.toContain("runIntegratedAction('BASE_RULES')");
    expect(page).not.toContain("runIntegratedAction('OPENCLAW_OVERALL')");
    expect(page).not.toContain('运行 Base 固定规则评估');
    expect(api).not.toContain('persistIntegratedBaseRules');
    expect(api).not.toContain('persistIntegratedOpenClawOverall');
    expect(api).not.toContain('evaluateAssessment');
    expect(api).not.toContain('resynthesizeAssessment');
    expect(page).toContain('保存只记录工程师判断，不会直接改写逐项评估结果');
    expect(page).toContain('confirmIntegratedOverallForAeo');
  });
});

function source(relative: string): Promise<string> {
  return readFile(resolve(root, relative), 'utf8');
}
