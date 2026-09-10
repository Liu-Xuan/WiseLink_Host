/** Isolated UI integration with explicit API fixtures. Never a real Host acceptance run. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base =
  process.env.ATLAS_TEST_URL || 'http://127.0.0.1:5187/app/app_17bzc551rsg';
const output = process.env.ATLAS_TEST_OUTPUT || '/private/tmp/wiselink-atlas';
fs.mkdirSync(output, { recursive: true });
const document = {
  kind: 'TASK',
  workItemId: 'WI-SB',
  revision: 5,
  documentVersionId: 'SB-R1',
  documentCode: 'SB-TEST',
  businessRevision: 'R1',
  originalFilename: 'SB fixture.pdf',
  familyId: 'F-SB',
  sourceReadability: 'NOT_CHECKED',
};
const catalog = {
  scope: 'CURRENT_USER_DOCUMENT_CATALOG',
  items: [
    {
      familyId: 'F-SB',
      documentCode: 'SB-TEST',
      versions: [
        {
          documentVersionId: 'SB-R1',
          businessRevision: 'R1',
          readerWorkItemId: 'WI-SB',
          originalFilename: 'SB fixture.pdf',
          selectedVersionIsCurrent: true,
        },
      ],
    },
    {
      familyId: 'F-FTD',
      documentCode: 'FTD-TEST',
      versions: [
        {
          documentVersionId: 'FTD-R3',
          businessRevision: 'R3',
          readerWorkItemId: 'WI-FTD-R3',
          originalFilename: 'FTD R3.pdf',
        },
        {
          documentVersionId: 'FTD-R4',
          businessRevision: 'R4',
          readerWorkItemId: 'WI-FTD-R4',
          originalFilename: 'FTD R4.pdf',
          selectedVersionIsCurrent: true,
        },
      ],
    },
  ],
  nextCursor: null,
  totalCount: 2,
  fileReadPerformed: false,
};
const preview = {
  revision: 5,
  snapshot: { workItemRef: 'WI-SB' },
  mentions: [
    {
      mentionId: 'mention-1',
      primaryDocumentVersionRef: 'SB-R1',
      permissionState: 'AUTHORIZED',
      citationText: 'FTD-TEST R3',
      normalizedIdentity: { documentNumber: 'FTD-TEST' },
      targetResolution: {
        status: 'RESOLVED_EXACT',
        workItemId: 'WI-FTD-R3',
        documentVersionId: 'FTD-R3',
        businessRevision: 'R3',
      },
      sourceRefIds: ['source-SB-1'],
      sourceLocators: [
        { sourceRefId: 'source-SB-1', quote: 'See FTD-TEST revision 3.' },
      ],
      matchedText: 'See FTD-TEST revision 3.',
    },
  ],
};
const checks = [];
const errors = [];
const calls = [];
(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
    });
    const page = await context.newPage();
    page.on('pageerror', (e) => errors.push(e.message));
    await context.route('**/*', async (route) => {
      const req = route.request(),
        url = req.url();
      if (!url.startsWith(new URL(base).origin + '/')) return route.abort();
      if (url === base + '/atlas-test')
        return route.fulfill({
          contentType: 'text/html',
          body: `<html lang="zh"><head><script type="module">import { injectIntoGlobalHook } from "${base}/@react-refresh";injectIntoGlobalHook(window);window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>(type)=>type;window.__vite_plugin_react_preamble_installed__=true;</script></head><body><div id="root"></div><script type="module" src="${base}/test/atlas/harness.tsx"></script></body></html>`,
        });
      if (url.includes('/api/canonical-host/')) {
        calls.push({ method: req.method(), url });
        assert.equal(
          req.method(),
          'GET',
          'Atlas must not write business state',
        );
        let body;
        if (url.includes('/library/documents')) body = catalog;
        else if (url.includes('/WI-SB/quicklook'))
          body = {
            document,
            result: {
              status: 'CANDIDATE_ONLY',
              sourceResultId: 'saved-result-1',
              revision: 1,
              overallCandidate:
                'Saved fixture candidate with unresolved implementation conditions.',
            },
            fileReadPerformed: false,
          };
        else if (url.includes('/WI-SB/related-context/explicit-preview'))
          body = preview;
        else if (url.includes('/WI-FTD-R3/quicklook'))
          body = {
            document: {
              ...document,
              workItemId: 'WI-FTD-R3',
              documentVersionId: 'FTD-R3',
              documentCode: 'FTD-TEST',
              businessRevision: 'R3',
              familyId: 'F-FTD',
            },
            result: null,
            fileReadPerformed: false,
          };
        else if (url.includes('/WI-FTD-R3/related-context/explicit-preview'))
          body = {
            revision: 5,
            snapshot: { workItemRef: 'WI-FTD-R3' },
            mentions: [],
          };
        else
          return route.fulfill({
            status: 503,
            json: { message: 'Explicit test unavailable' },
          });
        return route.fulfill({ json: body });
      }
      if (url.includes('/__runtime__/api/'))
        return route.fulfill({
          json: { data: { user_info: { user_id: 'TEST-ONLY' } } },
        });
      return route.continue();
    });
    await page.goto(base + '/atlas-test');
    await page.getByRole('button', { name: '打开图谱与自动演示' }).click();
    const root = page.locator('.atlas-workspace');
    const guide = page.locator('.atlas-guide');
    if (process.env.ATLAS_VISUAL_ONLY === '1') {
      await root.locator('select').first().selectOption('EXAMPLE');
      await page.getByRole('button', { name: '切换图谱全屏' }).click();
      await page.waitForFunction(() => !!document.fullscreenElement);
      assert(await page.evaluate(() => !!document.fullscreenElement));
      await page.getByRole('button', { name: '切换图谱全屏' }).click();
      await page.waitForFunction(() => !document.fullscreenElement);
      assert.equal(
        await page.evaluate(() => !!document.fullscreenElement),
        false,
      );
      await page.setViewportSize({ width: 1600, height: 1000 });
      await page
        .locator('.atlas-tabs')
        .getByRole('button', { name: '工程文档', exact: true })
        .click();
      await page.getByRole('button', { name: '全图适配' }).click();
      await root.screenshot({ path: path.join(output, 'documents-light.png') });
      await page.getByRole('button', { name: '切换图谱主题' }).click();
      await page
        .locator('.atlas-tabs')
        .getByRole('button', { name: '技术领域', exact: true })
        .click();
      await page.getByRole('button', { name: '全图适配' }).click();
      await root.screenshot({ path: path.join(output, 'domain-dark.png') });
      await page
        .locator('.atlas-tabs')
        .getByRole('button', { name: '全景', exact: true })
        .click();
      await page.getByRole('button', { name: '全图适配' }).click();
      await root.screenshot({ path: path.join(output, 'panorama-dark.png') });
      await page.getByRole('button', { name: '切换图谱主题' }).click();
      await page.setViewportSize({ width: 390, height: 844 });
      await guide
        .getByRole('button', {
          name: '完成一次工程事项评估与复核',
          exact: true,
        })
        .click();
      await guide
        .getByRole('combobox', { name: '跳转讲解章节' })
        .selectOption('8');
      await guide.getByRole('button', { name: '暂停', exact: true }).waitFor();
      await root.screenshot({ path: path.join(output, 'mobile-review.png') });
      await page.getByRole('button', { name: '切换图谱主题' }).click();
      await page.getByRole('button', { name: '关闭图谱并返回阅读' }).click();
      await root.waitFor({ state: 'detached' });
      await page.waitForFunction(
        () => document.documentElement.dataset.wlTheme === 'light',
      );
      assert.equal(
        await page.evaluate(() => document.documentElement.dataset.wlTheme),
        'light',
      );
      assert.equal(
        await page
          .getByRole('textbox', { name: 'Background draft' })
          .inputValue(),
        'keep this unsent draft',
      );
      assert.deepEqual(errors, []);
      fs.writeFileSync(
        path.join(output, 'visual-results.json'),
        JSON.stringify(
          {
            scope: 'isolated fixtures',
            checks: [
              'Native fullscreen enter/exit',
              '1600px light/dark native graphs',
              '390px shared review and player',
              'Closing active guide restores theme and retains background draft',
            ],
            errors,
            writes: calls.filter((r) => r.method !== 'GET').length,
          },
          null,
          2,
        ),
      );
      console.log(
        'Visual verification passed; fullscreen, desktop themes, mobile, close restore.',
      );
      return;
    }

    await page
      .locator('.atlas-inspector summary')
      .filter({ hasText: '等价对象列表' })
      .click();
    await page
      .locator('.atlas-object')
      .filter({ hasText: 'SB-TEST R1' })
      .click();
    await page.getByRole('button', { name: '读取此确切版本关系' }).click();
    await page
      .locator('.atlas-object')
      .filter({ hasText: 'FTD-TEST R3' })
      .click();
    assert.equal(
      await page
        .locator('.atlas-object')
        .filter({ hasText: 'FTD-TEST R4' })
        .count(),
      0,
    );
    assert((await root.innerText()).includes('Saved fixture candidate'));
    await page
      .getByRole('button', { name: '来源 source-SB-1', exact: true })
      .click();
    assert((await root.innerText()).includes('See FTD-TEST revision 3.'));
    checks.push(
      'Host adapter fixture: exact R3, occurrence and same saved candidate',
    );
    await guide
      .getByRole('button', { name: '从文件到机队技术全貌', exact: true })
      .click();
    await guide.getByRole('button', { name: '暂停', exact: true }).waitFor();
    await guide.getByRole('button', { name: '退出演示并恢复' }).click();
    await guide
      .getByRole('button', { name: '从文件到机队技术全貌', exact: true })
      .waitFor();
    assert((await root.innerText()).includes('See FTD-TEST revision 3.'));
    assert(
      (await page.locator('.atlas-inspector h2').innerText()).includes(
        'FTD-TEST R3',
      ),
    );
    checks.push(
      'Host exit restores exact selection and source after fresh read',
    );
    const beforeHostCalls = calls.length;
    const tracks = [
      ['从文件到机队技术全貌', 13],
      ['完成一次工程事项评估与复核', 16],
      ['系统怎样形成并更新评估意见', 12],
    ];
    for (const [title, count] of tracks) {
      await guide.getByRole('button', { name: title, exact: true }).click();
      for (let i = 0; i < count; i++) {
        await guide
          .getByRole('combobox', { name: '跳转讲解章节' })
          .selectOption(String(i));
        await guide
          .getByRole('button', { name: '暂停', exact: true })
          .waitFor({ timeout: 18000 });
        assert.equal(
          await root.locator('[role=alert]').count(),
          0,
          `scene ${title}/${i}`,
        );
        assert(
          (await guide.locator('.atlas-caption p').first().innerText()).length >
            20,
        );
      }
      await guide.getByRole('button', { name: '在此探索' }).click();
      checks.push(`${title}: ${count} scenes ready`);
      console.log('Ready:', title, count);
    }
    assert.equal(
      calls.length,
      beforeHostCalls,
      'Example playback must not call Host',
    );
    await page
      .locator('.atlas-tabs')
      .getByRole('button', { name: '工程师交互复核', exact: true })
      .click();
    await page
      .getByRole('textbox', { name: '探索笔记（仅留在本次面板，不发送）' })
      .fill('restore this atlas note');
    await guide
      .getByRole('button', { name: tracks[0][0], exact: true })
      .click();
    const chapters = guide.getByRole('combobox', { name: '跳转讲解章节' });
    await chapters.selectOption('3');
    await chapters.selectOption('11');
    await chapters.selectOption('5');
    await guide.getByRole('button', { name: '暂停', exact: true }).waitFor();
    assert.equal(await chapters.inputValue(), '5');
    checks.push('Rapid jump: last selected scene wins');
    await guide.getByRole('button', { name: '暂停', exact: true }).click();
    const remaining = await guide.locator('.atlas-guide-status').innerText();
    await page.waitForTimeout(450);
    assert.equal(
      await guide.locator('.atlas-guide-status').innerText(),
      remaining,
    );
    checks.push('Pause freezes remaining dwell');
    await guide.getByRole('button', { name: '退出演示并恢复' }).click();
    await guide
      .getByRole('button', { name: tracks[0][0], exact: true })
      .waitFor();
    assert.equal(
      await page
        .getByRole('textbox', { name: '探索笔记（仅留在本次面板，不发送）' })
        .inputValue(),
      'restore this atlas note',
    );
    checks.push('Exit restores example view and unsent note');
    await page
      .locator('.atlas-tabs')
      .getByRole('button', { name: '分类骨架', exact: true })
      .click();
    await page.getByRole('button', { name: '45-45', exact: true }).click();
    assert((await page.locator('tbody tr').count()) >= 2);
    await guide
      .getByRole('button', { name: tracks[0][0], exact: true })
      .click();
    await guide.getByRole('button', { name: '暂停', exact: true }).waitFor();
    await guide.getByRole('button', { name: '退出演示并恢复' }).click();
    await page.getByRole('textbox', { name: '筛选分类原值' }).waitFor();
    assert.equal(
      await page.getByRole('textbox', { name: '筛选分类原值' }).inputValue(),
      '45-45',
    );
    checks.push('Exit restores raw classification filter');
    await guide
      .getByRole('button', { name: tracks[0][0], exact: true })
      .waitFor();
    await page
      .locator('.atlas-tabs')
      .getByRole('button', { name: '全景', exact: true })
      .click();
    await page.locator('.atlas-graph[data-render-ms]').waitFor();
    await root.screenshot({ path: path.join(output, 'panorama.png') });
    await guide
      .getByRole('button', { name: tracks[0][0], exact: true })
      .click();
    await guide.getByRole('button', { name: '暂停', exact: true }).waitFor();
    await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', {
        configurable: true,
        value: true,
      });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await guide.getByRole('button', { name: '继续', exact: true }).waitFor();
    checks.push('Hidden page pauses');
    await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', {
        configurable: true,
        value: false,
      });
    });
    await guide.getByRole('button', { name: '继续', exact: true }).click();
    await guide.getByRole('button', { name: '暂停', exact: true }).waitFor();
    await page
      .locator('[data-atlas-target=graph]')
      .evaluate((el) => el.removeAttribute('data-atlas-target'));
    await guide.getByRole('alert').waitFor();
    checks.push('Missing target stops playback');
    await guide.getByRole('button', { name: '在此探索' }).click();
    await page
      .locator('.atlas-graph')
      .evaluate((el) => el.setAttribute('data-atlas-target', 'graph'));
    await page.setViewportSize({ width: 1600, height: 1000 });
    for (const [view, file] of [
      ['工程文档', 'documents'],
      ['文档关系网', 'network'],
      ['技术领域', 'domain'],
      ['事项图谱', 'matter'],
      ['依据与反证', 'evidence'],
      ['工作线', 'runtime'],
      ['初始综合评估', 'initial'],
    ]) {
      await page
        .locator('.atlas-tabs')
        .getByRole('button', { name: view, exact: true })
        .click();
      await page.waitForTimeout(200);
      await root.screenshot({ path: path.join(output, file + '-light.png') });
    }
    await page
      .locator('.atlas-tabs')
      .getByRole('button', { name: '分类骨架', exact: true })
      .click();
    await page.getByRole('textbox', { name: '筛选分类原值' }).fill('');
    await page
      .getByRole('combobox', { name: '分类命名空间' })
      .selectOption('ispec');
    await page.getByRole('combobox', { name: '分类章节' }).selectOption('34');
    await page.getByRole('button', { name: '分类图', exact: true }).click();
    await page.waitForTimeout(200);
    await root.screenshot({
      path: path.join(output, 'classification-light.png'),
    });
    await page
      .locator('.atlas-tabs')
      .getByRole('button', { name: '技术领域', exact: true })
      .click();
    await page
      .getByRole('combobox', { name: '观察软件标准' })
      .selectOption('A');
    const countWithUnknown = await page.locator('.atlas-count').innerText();
    await page.getByRole('checkbox', { name: '保留范围待核' }).uncheck();
    assert.notEqual(
      await page.locator('.atlas-count').innerText(),
      countWithUnknown,
    );
    await page.getByRole('checkbox', { name: '保留范围待核' }).check();
    await page
      .getByRole('combobox', { name: '观察软件标准' })
      .selectOption('all');
    checks.push('Domain scope keeps unknown records until explicitly excluded');
    await page.getByRole('button', { name: '切换图谱主题' }).click();
    assert.equal(await root.getAttribute('data-theme'), 'dark');
    for (const [view, file] of [
      ['工程文档', 'documents'],
      ['技术领域', 'domain'],
      ['全景', 'panorama'],
    ]) {
      await page
        .locator('.atlas-tabs')
        .getByRole('button', { name: view, exact: true })
        .click();
      await page.waitForTimeout(250);
      await root.screenshot({ path: path.join(output, file + '-dark.png') });
    }
    await page
      .locator('.atlas-tabs')
      .getByRole('button', { name: '工程文档', exact: true })
      .click();
    await guide
      .getByRole('button', { name: tracks[0][0], exact: true })
      .click();
    await guide.getByRole('button', { name: '暂停', exact: true }).waitFor();
    await page.getByRole('button', { name: '切换图谱主题' }).click();
    await guide.getByRole('button', { name: '继续', exact: true }).waitFor();
    await page.locator('.atlas-graph').click({ position: { x: 15, y: 15 } });
    await page.keyboard.press('ArrowRight');
    await guide.getByRole('button', { name: '暂停', exact: true }).waitFor();
    assert.equal(
      await guide.getByRole('combobox', { name: '跳转讲解章节' }).inputValue(),
      '1',
    );
    await page.keyboard.press('Escape');
    await guide
      .getByRole('button', { name: tracks[0][0], exact: true })
      .waitFor();
    assert.equal(await root.getAttribute('data-theme'), 'dark');
    checks.push(
      'Keyboard changes scenes; Escape restores theme without closing workspace',
    );
    await page.getByRole('button', { name: '关闭图谱并返回阅读' }).click();
    await page.getByRole('button', { name: '打开图谱与自动演示' }).click();
    await page.locator('.atlas-graph[data-render-ms]').waitFor();
    assert.equal(await root.getAttribute('data-theme'), 'dark');
    checks.push('Reopen retains atlas view independently of underlying draft');
    await page.getByRole('button', { name: '切换图谱主题' }).click();
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page
      .getByRole('combobox', { name: '图谱效果', exact: true })
      .selectOption('compatible');
    await page
      .locator('.atlas-tabs')
      .getByRole('button', { name: '技术领域', exact: true })
      .click();
    await page.waitForTimeout(200);
    await root.screenshot({ path: path.join(output, 'domain-compatible.png') });
    assert.equal(await root.getAttribute('data-effect'), 'compatible');
    checks.push('Compatible rendering and reduced-motion preferences');
    await page.setViewportSize({ width: 390, height: 844 });
    await guide
      .getByRole('button', { name: tracks[1][0], exact: true })
      .click();
    await guide.getByRole('button', { name: '暂停', exact: true }).waitFor();
    await guide
      .getByRole('combobox', { name: '跳转讲解章节' })
      .selectOption('8');
    await guide.getByRole('button', { name: '暂停', exact: true }).waitFor();
    const bounds = await root.boundingBox();
    assert(bounds.x >= 0 && bounds.x + bounds.width <= 391);
    await root.screenshot({ path: path.join(output, 'mobile-review.png') });
    checks.push('390px layout and caption controls');
    await page.getByRole('button', { name: '关闭图谱并返回阅读' }).click();
    assert.equal(
      await page
        .getByRole('textbox', { name: 'Background draft' })
        .inputValue(),
      'keep this unsent draft',
    );
    checks.push('Close keeps underlying page mounted and draft intact');
    assert.deepEqual(errors, []);
    console.log(
      JSON.stringify(
        {
          scope: 'isolated browser with API fixtures',
          checks,
          businessRequests: calls.length,
          writes: calls.filter((r) => r.method !== 'GET').length,
        },
        null,
        2,
      ),
    );
    fs.writeFileSync(
      path.join(output, 'browser-results.json'),
      JSON.stringify({ checks, errors, calls }, null, 2),
    );
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
