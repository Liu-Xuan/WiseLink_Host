// Local synthetic API only. No Host, database, Native, model or credentials.
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer as createViteServer } from 'vite';

const directory = dirname(fileURLToPath(import.meta.url)), host = resolve(directory, '../../..');
process.env.TS_NODE_PROJECT = resolve(host, 'tsconfig.node.json');
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'node' });
const require = createRequire(import.meta.url); require('ts-node/register/transpile-only'); require('tsconfig-paths/register');
const { summaryExact, summaryKnowledge } = require('../../unit/fixtures/derived-summary.ts');
let revision = 2, denied = false;
const calls = [];
const models = ['B787', 'B777-300ER', 'A320-200'];
const titles = { '21': '空调', '22': '自动飞行', '23': '通信', '24': '电源', '26': '防火',
  '27': '飞行操纵', '28': '燃油', '30': '防冰与排雨', '31': '指示/记录', '32': '起落架', '34': '导航', '46': '信息系统' };
const afterOffset = value => value ? Number(Buffer.from(value, 'base64url').toString('utf8')) : 0;
const afterCursor = offset => Buffer.from(String(offset)).toString('base64url');
function savedWork() {
  const value = summaryKnowledge(), seed = value.content.issues[0];
  Object.assign(value.entry, { subjectId: 'WI-1', workRef: 'JAWR-1', workRevision: 3,
    headline: '本地样例：软件构型核对', listBrief: '仅供界面验证的合成已保存工作' });
  value.content.issues = Array.from({ length: 55 }, (_, index) => ({ ...structuredClone(seed),
    issueKey: `fixture-${index + 1}`, issueRef: `fixture-ref-${index + 1}`,
    question: `本地样例问题 ${index + 1} · 软件构型与来源核对`, body: '本地合成的已保存问题正文，不是工程评估。' }));
  value.content.decisiveIssueKeys = ['fixture-1'];
  Object.assign(value.reading, { resultRef: 'JAWR-1', resultRevision: 3,
    scope: { kind: 'WORK_ITEM', workItemId: 'WI-1', documentVersionId: 'DV-1' } });
  value.reading.content.issueArticles = value.content.issues.map(({ issueKey, issueRef, question, body }) => ({ issueKey, issueRef, question, body }));
  return value;
}
function makeNode(model, ata2 = null, ata4 = null) {
  const modelIndex = models.indexOf(model) + 1;
  const identity = (two = null, four = null) => 'DS-00000000-0000-4000-8000-' + String(modelIndex * 1_000_000
    + (two ? Number(two) * 1000 : 0) + (four ? Number(four.slice(3)) + 1 : 0)).padStart(12, '0');
  const rootId = identity(), parent = ata4 ? identity(ata2) : ata2 ? rootId : null;
  const id = identity(ata2, ata4);
  const empty = !ata2 && model === 'B787';
  const value = { summaryId: id, parentSummaryId: parent, wikiId: `wiki-${id}`, enabled: true,
    currentSummaryRef: empty ? null : `DSR-${id}-${revision}`, currentRevision: empty ? 0 : revision,
    currentBodyStatus: 'AVAILABLE', state: empty ? 'EMPTY' : 'CURRENT',
    scope: { kind: ata4 ? 'ATA4' : ata2 ? 'ATA2' : 'FLEET', title: ata4 ? `${model} ATA ${ata4}`
      : ata2 ? `${model} ATA ${ata2} ${titles[ata2] ?? ''}` : `${model} Wiki`,
    fleetFamilyId: model, fleetModelIds: [], ata2, ata4, selectionReason: '本地合成范围，仅供界面检查' }, path: [] };
  value.path = [...(ata4 ? makeNode(model, ata2).path : ata2 ? makeNode(model).path : []),
    { summaryId: id, parentSummaryId: parent, scope: value.scope,
      currentSummaryRef: value.currentSummaryRef, currentRevision: value.currentRevision }];
  return value;
}
function allNodes() {
  return models.flatMap(model => [makeNode(model), ...Object.keys(titles).flatMap(ata2 =>
    [makeNode(model, ata2), ...Array.from({ length: 26 }, (_, i) => makeNode(model, ata2, `${ata2}-${String(i).padStart(2, '0')}`))])]);
}
const hmrProbe = createServer();
await new Promise(resolve => hmrProbe.listen(0, '127.0.0.1', resolve));
const hmrPort = hmrProbe.address().port;
await new Promise(resolve => hmrProbe.close(resolve));
const vite = await createViteServer({ configFile: false, root: directory, appType: 'spa',
  publicDir: resolve(host, 'client/public'), esbuild: { jsx: 'automatic' },
  server: { middlewareMode: true, hmr: { host: '127.0.0.1', port: hmrPort }, fs: { allow: [host] } },
  define: { 'process.env': JSON.stringify({ NODE_ENV: 'development' }),
    __WISELINK_SOURCE_COMMIT__: JSON.stringify('LOCAL_WIKI_GUIDE_FIXTURE'),
    __WISELINK_BUILD_TIME__: JSON.stringify('2026-10-17'), __WISELINK_VISUAL_VERSION__: JSON.stringify('LOCAL') },
  resolve: { alias: [
    { find: '@lark-apaas/client-toolkit/utils/getAxiosForBackend', replacement: resolve(directory, '../library-toolbar/transport.ts') },
    { find: '@lark-apaas/client-toolkit/auth', replacement: resolve(directory, '../library-toolbar/transport.ts') },
    { find: '@client', replacement: resolve(host, 'client') }, { find: '@shared', replacement: resolve(host, 'shared') },
    { find: '@', replacement: resolve(host, 'client/src') },
  ] },
});
const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://127.0.0.1');
  if (!url.pathname.startsWith('/api/') && url.pathname !== '/fixture-control') return vite.middlewares(req, res);
  res.setHeader('Content-Type', 'application/json'); res.setHeader('Cache-Control', 'no-store');
  const log = { path: url.pathname, query: url.search, method: req.method, startedAt: performance.now() };
  const send = (data, status = 200) => {
    const body = JSON.stringify(data); res.statusCode = status;
    calls.push({ ...log, bytes: Buffer.byteLength(body), status, elapsedMs: performance.now() - log.startedAt });
    res.end(body);
  };
  if (url.pathname === '/fixture-control') {
    if (url.searchParams.get('action') === 'deny') denied = true;
    if (url.searchParams.get('action') === 'allow') denied = false;
    if (url.searchParams.get('action') === 'revision') revision++;
    return res.end(JSON.stringify({ localSyntheticOnly: true, denied, revision, calls }));
  }
  if (req.method !== 'GET') return send({ code: 'LOCAL_READ_ONLY' }, 405);
  if (url.pathname.endsWith('/identity-context')) return send({ userId: 'local-fixture-reader',
    tenantId: 'local-fixture-tenant', appId: 'local-fixture-app', developmentIntakeAvailable: false });
  if (denied) return send({ code: 'LOCAL_TEST_REVOKED' }, 403);
  const nodes = allNodes();
  if (url.pathname.endsWith('/hierarchical-wiki/navigation')) {
    const id = url.searchParams.get('summaryId'), parent = url.searchParams.get('parentSummaryId');
    const root = url.searchParams.get('rootSummaryId'), query = url.searchParams.get('search')?.trim().toLowerCase();
    const selected = id ? nodes.filter(node => node.summaryId === id) : query
      ? nodes.filter(node => node.scope.kind !== 'FLEET' && (!root || node.path[0].summaryId === root)
        && (node.scope.title.toLowerCase().includes(query) || (node.scope.ata4 ?? node.scope.ata2 ?? '').replace('-', '').includes(query.replace(/[\s-]/g, ''))))
      : nodes.filter(node => node.parentSummaryId === (parent ?? null));
    const offset = afterOffset(url.searchParams.get('after')), limit = Number(url.searchParams.get('limit') ?? 20);
    return send({ items: selected.slice(offset, offset + limit), nextCursor: selected.length > offset + limit ? afterCursor(offset + limit) : null });
  }
  if (url.pathname.endsWith('/engineering-issues/wiki-guide')) {
    const root = nodes.find(node => node.summaryId === url.searchParams.get('rootSummaryId'));
    if (!root) return send({ code: 'LOCAL_SCOPE_MISSING' }, 404);
    const chapter = nodes.find(node => node.summaryId === url.searchParams.get('chapterSummaryId'));
    const node = makeNode(root.scope.fleetFamilyId, chapter?.scope.ata2 ?? '31', `${chapter?.scope.ata2 ?? '31'}-10`);
    const query = url.searchParams.get('search')?.trim().toLowerCase() ?? '';
    const candidates = Array.from({ length: 55 }, (_, index) => ({ subjectKind: 'WORK_ITEM', subjectId: 'WI-1',
      workRef: 'JAWR-1', workRevision: 3, issueKey: `fixture-${index + 1}`, question: `本地样例问题 ${index + 1} · 软件构型与来源核对`,
      documentVersionId: 'DV-1', paths: [node.path] })).filter(item => item.question.toLowerCase().includes(query));
    const offset = afterOffset(url.searchParams.get('after')), limit = Number(url.searchParams.get('limit') ?? 20);
    return send({ items: candidates.slice(offset, offset + limit), nextCursor: candidates.length > offset + limit ? afterCursor(offset + limit) : null,
      coverage: 'CONFIRMED_WIKI_MEMBERS' });
  }
  const exact = /\/derived-summaries\/([^/]+)\/revisions\/([^/]+)$/u.exec(url.pathname);
  if (exact) {
    const id = decodeURIComponent(exact[1]), ref = decodeURIComponent(exact[2]), node = nodes.find(item => item.summaryId === id);
    if (!node) return send({ code: 'LOCAL_SCOPE_MISSING' }, 404);
    const savedRevision = Number(ref.match(/-(\d+)$/u)?.[1]);
    if (!Number.isInteger(savedRevision) || savedRevision < 1 || savedRevision > revision || ref !== `DSR-${id}-${savedRevision}`)
      return send({ code: 'LOCAL_EXACT_REF_MISSING' }, 404);
    const data = summaryExact(ref); data.summaryId = id; data.currentSummaryRef = node.currentSummaryRef;
    data.currentRevision = revision; data.automaticWiki = true; data.parentSummaryId = node.parentSummaryId;
    Object.assign(data.revision, { summaryId: id, scope: node.scope, revision: savedRevision, members: [], coverage: [], usedEvidenceRefs: [], evidence: [] });
    data.revision.content = { headline: node.scope.title, listBrief: '本地合成已保存正文',
      body: '本地合成阅读内容，用于核对准确版本入口、页面返回与布局。此内容不是工程资料或线上 Wiki。', limitations: [] };
    data.memberNotices = []; return send(data);
  }
  if (url.pathname.endsWith('/engineering-issues/catalogue/work')) return send(savedWork());
  if (url.pathname.endsWith('/engineering-issues/catalogue')) return send({ entries: [savedWork().entry], nextCursor: null });
  return send({ code: 'LOCAL_FIXTURE_PATH_NOT_CONFIGURED' }, 404);
});
server.listen(0, '127.0.0.1', () => process.stdout.write(`Local synthetic Wiki guide: http://127.0.0.1:${server.address().port}/situation\n`));
process.on('SIGINT', async () => { server.close(); await vite.close(); process.exit(0); });
