import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(__dirname, '../..');

describe('single canonical app workspace', () => {
  it('absorbs the workbench and document tree without reviving module apps', async () => {
    const [
      routes,
      layout,
      currentUser,
      currentUserSession,
      currentObjectContext,
      floatingDock,
      contextualNavigation,
      home,
      engineeringQuicklook,
      page,
      tree,
      dock,
      trail,
      shell,
      intake,
      taskPills,
      themeProvider,
      tokens,
      glass,
      indexStyles,
      homeStyles,
      motion,
      overallHero,
      workItemOverview,
      overallRegeneration,
      reasoningTrail,
      reader,
      workbenchStyles,
      evidenceStyles,
      documentParsingStyles,
      visualModeControl,
      visualModeStyles,
      appShellStyles,
      tailwindThemeStyles,
      quickOpen,
      pdfSourceStyles,
      structuredBrowserStyles,
    ] = await Promise.all([
      source('client/src/app.tsx'),
      source('client/src/components/Layout.tsx'),
      source('client/src/components/CurrentUserControl.tsx'),
      source('client/src/app/providers/CurrentUserSessionProvider.tsx'),
      source('client/src/app/providers/CurrentObjectContextProvider.tsx'),
      source('client/src/features/navigation/FloatingDock.tsx'),
      source('client/src/features/navigation/contextual-navigation.ts'),
      source('client/src/pages/WorkspaceHomePage/WorkspaceHomePage.tsx'),
      source('client/src/pages/WorkspaceHomePage/EngineeringQuicklook.tsx'),
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
      source('client/src/styles/tokens.css'),
      source('client/src/styles/glass.css'),
      source('client/src/index.css'),
      source('client/src/pages/WorkspaceHomePage/workspace-home.css'),
      source('client/src/styles/motion.css'),
      source('client/src/features/workitem/OverallAssessmentHero.tsx'),
      source('client/src/features/workitem/WorkItemOverviewPage.tsx'),
      source('client/src/features/workitem/useOverallRegeneration.ts'),
      source(
        'client/src/pages/DocumentParsingPage/EngineeringReasoningTrail.tsx',
      ),
      source(
        'client/src/pages/DocumentParsingPage/DocumentReaderWorkspace.tsx',
      ),
      source('client/src/features/workbench/workbench-shell.css'),
      source('client/src/features/workbench/evidence-panel.css'),
      source('client/src/pages/DocumentParsingPage/document-parsing.css'),
      source('client/src/components/VisualModeControl.tsx'),
      source('client/src/components/visual-mode-control.css'),
      source('client/src/components/app-shell.css'),
      source('client/src/tailwind-theme.css'),
      source('client/src/features/workbench/QuickOpen.tsx'),
      source('client/src/pages/DocumentParsingPage/pdf-source-pane.css'),
      source(
        'client/src/pages/DocumentParsingPage/structured-content-browser.css',
      ),
    ]);

    expect(routes).toContain('WorkspaceHomePage');
    expect(routes).toContain('<LibraryIndexRedirect />');
    expect(routes).toContain("pathname: '/library'");
    expect(routes).toContain('search: location.search');
    expect(routes.split('element={<WorkspaceHomePage />}')).toHaveLength(2);
    expect(routes).toContain('work-items/:workItemId/documents');
    expect(routes).not.toContain('ailyCardsPreviewRoute');
    expect(routes).not.toContain('AilyCardsPreview');
    expect(routes).not.toContain('mockFixtures');
    expect(floatingDock).toContain('WiseLink 导航');
    expect(floatingDock).toContain('全局导航');
    expect(floatingDock).toContain('当前对象操作');
    expect(floatingDock).toContain('资料库');
    expect(floatingDock).toContain('工作台');
    expect(floatingDock).toContain('Job-Aid');
    expect(floatingDock).not.toContain('toggleTransparency');
    expect(floatingDock).not.toContain('is-disabled');
    expect(layout).toContain('wl-light--cold');
    expect(layout).toContain('wl-light--warm');
    expect(layout).toContain('wl-light--reflect');
    expect(layout).not.toContain('飞书身份');
    expect(layout).not.toContain('任务总览');
    expect(layout).not.toContain('唯一妙搭应用');
    expect(layout).not.toContain('CANONICAL HOST');
    expect(layout).toContain('<CurrentUserControl />');
    expect(layout).toContain('<CurrentUserSessionProvider>');
    expect(layout).toContain('<CurrentObjectContextProvider>');
    expect(currentObjectContext).toContain('currentRouteWorkItemId');
    expect(currentObjectContext).toContain(
      'published?.routeWorkItemId === routeWorkItemId',
    );
    expect(contextualNavigation).toContain('buildCurrentObjectContext');
    expect(contextualNavigation).toContain('buildEngineeringQuicklook');
    expect(contextualNavigation).toContain(
      '?node=overall&tab=overall#workspace-history',
    );
    expect(currentUserSession).toContain('authClient.session.getUserInfo()');
    expect(
      currentUserSession.split('authClient.session.getUserInfo()'),
    ).toHaveLength(2);
    expect(currentUserSession).toContain("window.addEventListener('pageshow'");
    expect(currentUserSession).not.toContain('MiaoDaMetaInfoChanged');
    expect(currentUser).not.toContain('useCurrentUserProfile');
    expect(currentUser).not.toContain('.getUserInfo()');
    expect(currentUser).toContain('useCurrentUserSession');
    expect(currentUser).toContain('authClient.session.redirectToLogin()');
    expect(currentUser).toContain('authClient.session.signOut()');
    expect(currentUser).toContain('<UserDisplay');
    expect(currentUser).toContain('退出登录');
    expect(workItemOverview).toContain('useCurrentUserSession');
    expect(workItemOverview).toContain(
      'getCanonicalHostClientSessionGeneration',
    );
    expect(workItemOverview).toContain('setView(null)');
    expect(workItemOverview).toContain(
      'viewSessionGeneration === sessionGeneration',
    );
    expect(home).toContain('loadedSessionGeneration === sessionGeneration');
    expect(overallRegeneration).toContain('[sessionGeneration, workItemId]');
    expect(home).toContain('尚无最近资料');
    expect(home).not.toContain('developmentIntakeAvailable ? null');
    expect(home).toContain('<EngineeringQuicklook');
    expect(engineeringQuicklook).toContain('当前判断');
    expect(engineeringQuicklook).toContain('为什么需要关注');
    expect(engineeringQuicklook).toContain('未决问题');
    expect(engineeringQuicklook).toContain('建议下一步');
    expect(engineeringQuicklook).toContain('当前版本／派生产物');
    expect(engineeringQuicklook).toContain("?? 'Host 未返回'");
    expect(engineeringQuicklook).toContain(
      '不推断附件、历史版本或外部关联资料',
    );
    expect(engineeringQuicklook).not.toContain('资料族、版本与附件');
    expect(engineeringQuicklook).not.toContain('sourceRefId}</');
    expect(page).toContain('WorkbenchShell');
    expect(page).toContain('NavigatorTree');
    expect(page).not.toContain('WorkItemContextTree');
    expect(page).toContain('EvidencePanel');
    expect(page).toContain('id="workspace-history"');
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
    expect(shell).toContain('移动端快捷操作');
    expect(shell).toContain('moreTriggerRef');
    expect(shell).toMatch(
      /\{!isCompact \? \(\s*<button[\s\S]*?wl-workbench-quick-open-trigger/,
    );
    expect(shell).toMatch(
      /\{!isCompact \? \(\s*<>[\s\S]*?ref=\{evidenceTriggerRef\}[\s\S]*?wl-workbench-focus-trigger/,
    );
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
    expect(themeProvider).toContain('wiselink.ui.visual-mode');
    expect(themeProvider).toContain('wlVisualMode');
    expect(tokens).toContain('--wl-text-caption: 12px');
    expect(tokens).toContain('--wl-text-meta: 12.5px');
    expect(tokens).toContain('--wl-touch-target: 44px');
    expect(tokens).toContain('--wl-g4-highlight:');
    expect(themeProvider).toContain("classList.toggle('dark'");
    expect(themeProvider).toContain('useLayoutEffect');
    expect(tailwindThemeStyles).toContain('--background: var(--wl-bg)');
    expect(tailwindThemeStyles).toContain('--popover: var(--wl-surface-solid)');
    expect(tailwindThemeStyles).toContain('--font-sans: var(--wl-font-sans)');
    expect(visualModeControl).toContain('默认效果');
    expect(visualModeControl).toContain('极致效果');
    expect(visualModeControl).toContain('兼容效果');
    expect(visualModeControl).toContain('降低透明度');
    expect(visualModeControl).toContain('切换浅色主题');
    expect(visualModeControl).toContain('切换深色主题');
    expect(quickOpen).toContain('event.metaKey || event.ctrlKey');
    expect(quickOpen).toContain('仅显示当前账户可读取的数据');
    expect(quickOpen).not.toContain('mock');
    expect(glass).toContain('@media (prefers-reduced-transparency: reduce)');
    expect(glass).toContain('@media (prefers-contrast: more)');
    expect(glass).toContain('@media (forced-colors: active)');
    expect(glass).toMatch(
      /-webkit-backdrop-filter: blur\(var\(--wl-blur-nav\)\)\s+saturate\(var\(--wl-saturation-nav\)\);\s+backdrop-filter: blur\(var\(--wl-blur-nav\)\)\s+saturate\(var\(--wl-saturation-nav\)\);/,
    );
    expect(glass).toMatch(
      /-webkit-backdrop-filter: none !important;\s+backdrop-filter: none !important;/,
    );
    expect(glass).not.toContain('brightness(1.035)');
    expect(glass).toContain("data-wl-visual-mode='compatible'");
    expect(glass).toContain('brightness(1.04)');
    expect(glass).toMatch(
      /html\[data-wl-transparency='reduced'\] \.wl-light \{\s+display: none;\s+animation: none !important;\s+\}/,
    );
    expect(glass).toMatch(
      /html\[data-wl-visual-mode='ultra'\] \.wl-light--cold \{\s+animation-duration: 22s;\s+\}/,
    );
    expect(indexStyles).toContain('#root');
    expect(indexStyles).toContain('min-height: 100dvh');
    expect(homeStyles).toContain('.library-tree-panel .wl-navigator');
    expect(homeStyles).toContain('避免 glass-on-glass');
    expect(homeStyles).not.toContain('font-family: ui-sans-serif');
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
    expect(page).toContain('onSourceRefSelect={locateSourceRef}');
    expect(page).toContain('quickOpenItems={quickOpenItems}');
    expect(page).toContain('buildDocumentTree(data.libraryIndex.nodes)');
    expect(shell).toContain('focusRestoreRef');
    expect(shell).toContain('进入专注阅读');
    expect(workbenchStyles).toMatch(
      /\.wl-workbench-body\s*\{\s*position: relative;/,
    );
    expect(shell).toContain('resolveWorkbenchAdaptiveLayout');
    expect(shell).toContain('ResizeObserver');
    expect(shell).toContain('is-evidence-overlay');
    expect(shell).toContain('展开资料目录并收起原文依据');
    expect(workbenchStyles).toContain('.wl-workbench-body.is-evidence-overlay');
    expect(workbenchStyles).toContain('container-name: wl-workbench-main');
    expect(workbenchStyles).not.toContain('@media (max-width: 1360px)');
    expect(workbenchStyles).not.toContain('@media (max-width: 1480px)');
    expect(evidenceStyles).toContain('grid-template-columns: minmax(0, 1fr)');
    expect(homeStyles).toContain(
      '.library-entry-grid.has-intake .hosted-intake-action',
    );
    expect(homeStyles).toMatch(
      /\.library-recent-preview\s*\{\s*width:\s*var\(--wl-touch-target\);\s*min-width:\s*var\(--wl-touch-target\);/,
    );
    expect(appShellStyles).toMatch(
      /\.wiselink-account-menu-trigger\s*\{\s*width:\s*var\(--wl-touch-target\);\s*height:\s*var\(--wl-touch-target\);/,
    );
    expect(appShellStyles).not.toContain('font-size: 8px');
    expect(visualModeStyles).toMatch(
      /\.wiselink-app-header\s+\.wl-visual-mode-trigger\s*\{\s*min-width:\s*var\(--wl-touch-target\);\s*width:\s*var\(--wl-touch-target\);\s*min-height:\s*var\(--wl-touch-target\);/,
    );
    expect(visualModeControl).toContain('Layers3');
    expect(visualModeControl).not.toContain('CircleGauge');
    expect(visualModeControl).toContain('视觉效果 ·');
    expect(visualModeControl).toContain('显示与视觉设置：');
    expect(workbenchStyles).toContain(
      'padding-bottom: var(--wl-workbench-mobilebar-height)',
    );
    expect(workbenchStyles).toContain(
      '--wl-workbench-mobilebar-height: var(--wl-mobile-navigation-block)',
    );
    expect(workbenchStyles).toContain(
      'inset: 45px 0 var(--wl-workbench-mobilebar-height)',
    );
    expect(workbenchStyles).toMatch(
      /\.wl-workbench-toolbar\s+\.wl-workbench-tool-btn\s*\{\s*width:\s*var\(--wl-touch-target\);\s*height:\s*var\(--wl-touch-target\);\s*min-width:\s*var\(--wl-touch-target\);/,
    );
    expect(workbenchStyles).toMatch(
      /\.wl-workbench-toolbar\s+\.wl-visual-mode-trigger\s*\{\s*width:\s*var\(--wl-touch-target\);\s*height:\s*var\(--wl-touch-target\);\s*min-width:\s*var\(--wl-touch-target\);\s*min-height:\s*var\(--wl-touch-target\);/,
    );
    expect(workbenchStyles).toMatch(
      /@media \(max-width: 720px\)[\s\S]*?\.wl-workbench-context-title\s*\{[\s\S]*?overflow:\s*hidden;[\s\S]*?\.wl-workbench-context-title strong\s*\{\s*display:\s*none;[\s\S]*?\.wl-workbench-context-title span\s*\{\s*display:\s*block;\s*min-width:\s*0;/,
    );
    expect(workbenchStyles).toMatch(
      /\.wl-workbench-drawer-close\s*\{[\s\S]*?min-height:\s*var\(--wl-touch-target\);/,
    );
    expect(workbenchStyles).toMatch(
      /\.wl-workbench-mobile-tab\s*\{\s*display:\s*flex;\s*min-width:\s*var\(--wl-touch-target\);\s*min-height:\s*var\(--wl-touch-target\);/,
    );
    expect(pdfSourceStyles).toMatch(
      /\.parse-pdf-toolbar button\s*\{\s*width:\s*var\(--wl-touch-target\);\s*height:\s*var\(--wl-touch-target\);/,
    );
    expect(pdfSourceStyles).toMatch(
      /\.parse-pdf-page-controls input\s*\{\s*width:\s*52px;\s*height:\s*var\(--wl-touch-target\);/,
    );
    expect(structuredBrowserStyles).toMatch(
      /\.structured-browser button,\s*\.structured-browser input,\s*\.structured-browser summary,\s*\.structured-browser a\s*\{\s*min-height:\s*var\(--wl-touch-target\);/,
    );
    expect(documentParsingStyles).toMatch(
      /data-content-layout='reader-single'[\s\S]*?\.parse-reader-split\.is-pdf-active[\s\S]*?\.parse-reader-workspace,[\s\S]*?data-content-layout='reader-single'[\s\S]*?\.parse-reader-split:not\(\.is-pdf-active\)[\s\S]*?\.parse-pdf-pane\s*\{\s*display:\s*none;/,
    );
    expect(documentParsingStyles).not.toMatch(
      /\.parse-reader-split\s*>\s*\.parse-pdf-pane\s*\{\s*display:\s*none;/,
    );
    expect(documentParsingStyles).toMatch(
      /\.parse-structured-pdf\s*\{\s*display:\s*none;/,
    );
    expect(documentParsingStyles).toContain(
      ".wl-workbench-main[data-content-layout='package-single']",
    );
    expect(documentParsingStyles).not.toContain(
      '@container wl-workbench-main (max-width:',
    );
    expect(documentParsingStyles).not.toContain(
      "body[data-wl-immersive='true'] .parse-shell--workbench {\n  height: 100vh",
    );
    expect(structuredBrowserStyles).not.toContain(
      'backdrop-filter: blur(18px)',
    );
    expect(pdfSourceStyles).not.toContain(
      'backdrop-filter: blur(var(--wl-blur-panel))',
    );
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
    expect(page).toMatch(
      /regeneration=\{\{\s*\.\.\.overallRegeneration,\s*disabled: loading \|\| overallRegeneration\.disabled,/u,
    );
    expect(api).toContain('requestOverallRegeneration');
    expect(api).toContain('getOverallRegenerationStatus');
    expect(page).toContain(
      '保存只记录工程师判断，不运行模型，也不会直接改写逐项评估结果',
    );
    expect(page).toContain('confirmIntegratedOverallForAeo');
  });
});

function source(relative: string): Promise<string> {
  return readFile(resolve(root, relative), 'utf8');
}
