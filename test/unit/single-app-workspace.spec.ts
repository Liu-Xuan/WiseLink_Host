import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(__dirname, '../..');

describe('single canonical app workspace', () => {
  it('absorbs the workbench and document tree without reviving module apps', async () => {
    const [
      routes,
      layout,
      floatingDock,
      page,
      tree,
      dock,
      trail,
      shell,
      intake,
      taskPills,
      themeProvider,
      glass,
      homeStyles,
      motion,
      overallHero,
      reasoningTrail,
      reader,
    ] = await Promise.all([
      source('client/src/app.tsx'),
      source('client/src/components/Layout.tsx'),
      source('client/src/features/navigation/FloatingDock.tsx'),
      source('client/src/pages/DocumentParsingPage/DocumentParsingPage.tsx'),
      source('client/src/pages/DocumentParsingPage/WorkItemContextTree.tsx'),
      source('client/src/pages/DocumentParsingPage/WorkItemContextDock.tsx'),
      source(
        'client/src/pages/DocumentParsingPage/EngineeringReasoningTrail.tsx',
      ),
      source('client/src/features/workbench/WorkbenchShell.tsx'),
      source('client/src/pages/WorkspaceHomePage/HostedDevelopmentIntake.tsx'),
      source('client/src/features/review/TaskPills.tsx'),
      source('client/src/app/providers/ThemeProvider.tsx'),
      source('client/src/styles/glass.css'),
      source('client/src/pages/WorkspaceHomePage/workspace-home.css'),
      source('client/src/styles/motion.css'),
      source('client/src/features/workitem/OverallAssessmentHero.tsx'),
      source(
        'client/src/pages/DocumentParsingPage/EngineeringReasoningTrail.tsx',
      ),
      source(
        'client/src/pages/DocumentParsingPage/DocumentReaderWorkspace.tsx',
      ),
    ]);

    expect(routes).toContain('WorkspaceHomePage');
    expect(routes).toContain('work-items/:workItemId/documents');
    expect(routes).not.toContain('ailyCardsPreviewRoute');
    expect(routes).not.toContain('AilyCardsPreview');
    expect(routes).not.toContain('mockFixtures');
    expect(floatingDock).toContain('WiseLink 主导航');
    expect(floatingDock).toContain('资料库');
    expect(floatingDock).toContain('补充资料');
    expect(floatingDock).toContain('toggleTransparency');
    expect(floatingDock).not.toContain('is-disabled');
    expect(layout).toContain('wl-light--cold');
    expect(layout).toContain('wl-light--warm');
    expect(layout).toContain('wl-light--reflect');
    expect(layout).not.toContain('飞书身份');
    expect(layout).not.toContain('任务总览');
    expect(layout).not.toContain('唯一妙搭应用');
    expect(layout).not.toContain('CANONICAL HOST');
    expect(page).toContain('WorkbenchShell');
    expect(page).toContain('WorkItemContextTree');
    expect(page).toContain('EvidencePanel');
    expect(tree).toContain('族群 · 文档 · 修订');
    expect(tree).toContain('随当前工程事项的最新资料更新');
    expect(dock).toContain('动态评估');
    expect(dock).toContain('当前事项摘要');
    expect(dock).toContain('已记录，不等于正式批准');
    expect(dock).not.toContain('permissionSnapshotVersion');
    expect(dock).not.toContain('candidateState');
    expect(trail).toContain('系统查阅了什么，以及候选如何形成');
    expect(trail).toContain('不把模型不可审计的隐式思维草稿当作依据');
    expect(page).toContain('查看评估过程与版本详情');
    expect(page).toContain('sourceBoundCandidateCount');
    expect(page).toContain('externalDiscoveryIsEvidence');
    expect(shell).toContain(
      '沉浸模式只隐藏应用外壳，不隐藏工作台的资料目录与证据栏',
    );
    expect(shell).not.toContain('!immersive &&');
    expect(shell).toContain('wl-workbench-transparency-toggle');
    expect(intake).toContain(
      'navigate(`/work-items/${encodeURIComponent(workItemId)}`)',
    );
    expect(intake).not.toContain('node=document&tab=source');
    expect(taskPills).toContain(
      "if (upper.includes('CANDIDATE')) return 'candidate'",
    );
    expect(taskPills).toContain(
      "if (state === 'candidate') return '候选待复核'",
    );
    expect(taskPills).toContain('wl-status-dot');
    expect(themeProvider).toContain('wiselink.ui.reduce-transparency');
    expect(glass).toContain('@media (prefers-reduced-transparency: reduce)');
    expect(glass).toContain('@media (prefers-contrast: more)');
    expect(glass).toContain('@media (forced-colors: active)');
    expect(homeStyles).toContain('.library-tree-panel .wl-navigator');
    expect(homeStyles).toContain('避免 glass-on-glass');
    expect(motion).toContain('@keyframes wl-drift-cold');
    expect(motion).toContain(".wl-focus-card[data-active='true']::after");
    expect(motion).toContain('.wl-spin');
    expect(motion).toContain('.animate-spin');
    expect(overallHero).toContain("heroState === 'candidate'");
    expect(overallHero).toContain("heroState === 'obsolete'");
    expect(reasoningTrail).toContain(
      "state: dynamic ? 'candidate' : 'pending'",
    );
    expect(reader).not.toContain('PDF_PREVIEW_PROJECTION_MISSING');
    expect(reader).not.toContain('SOURCE_REF_NOT_IN_CURRENT_QUERY');
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
    expect(page).toContain(
      '保存只记录工程师判断，不运行模型，也不会直接改写逐项评估结果',
    );
    expect(page).toContain('confirmIntegratedOverallForAeo');
  });
});

function source(relative: string): Promise<string> {
  return readFile(resolve(root, relative), 'utf8');
}
