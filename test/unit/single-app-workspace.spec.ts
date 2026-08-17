import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(__dirname, '../..');

describe('single canonical app workspace', () => {
  it('absorbs the workbench and document tree without reviving module apps', async () => {
    const [routes, layout, page, tree, dock, trail, home] = await Promise.all([
      source('client/src/app.tsx'),
      source('client/src/components/Layout.tsx'),
      source('client/src/pages/DocumentParsingPage/DocumentParsingPage.tsx'),
      source('client/src/pages/DocumentParsingPage/WorkItemContextTree.tsx'),
      source('client/src/pages/DocumentParsingPage/WorkItemContextDock.tsx'),
      source(
        'client/src/pages/DocumentParsingPage/EngineeringReasoningTrail.tsx',
      ),
      source('client/src/pages/WorkspaceHomePage/WorkspaceHomePage.tsx'),
    ]);

    expect(routes).toContain('WorkspaceHomePage');
    expect(routes).toContain('work-items/:workItemId/documents');
    expect(layout).toContain('WiseLink 主导航');
    expect(layout).toContain('唯一妙搭应用');
    expect(page).toContain('workitem-workbench-layout');
    expect(page).toContain('WorkItemContextTree');
    expect(page).toContain('WorkItemContextDock');
    expect(tree).toContain('族群 · 文档 · 修订');
    expect(tree).toContain('服务端 fresh-read');
    expect(dock).toContain('OpenClaw 动态 N');
    expect(dock).toContain('不承接旧应用状态');
    expect(trail).toContain('方法、依据、缺口与人工动作');
    expect(trail).toContain('不把模型不可审计的隐式思维草稿当作依据');
    expect(page).toContain('动态规则与整体候选审计信息');
    expect(page).toContain('sourceBoundCandidateCount');
    expect(page).toContain('externalDiscoveryIsEvidence');
    expect(home).toContain('这是唯一正式妙搭应用');
    expect(home).not.toContain('app_');
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
    expect(page).toContain('页面不直接运行模型');
    expect(page).toContain('confirmIntegratedOverallForAeo');
  });
});

function source(relative: string): Promise<string> {
  return readFile(resolve(root, relative), 'utf8');
}
