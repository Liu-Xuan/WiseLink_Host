/** Isolated browser fixture, never a business document or real source locator. */
import { build, context } from 'esbuild';
import { createServer } from 'node:http';
import { mkdtemp, readFile, writeFile, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, extname } from 'node:path';
import { pathToFileURL } from 'node:url';
const root = resolve('.');
const output = await mkdtemp(join(tmpdir(), 'wiselink-reader-preview-'));
const helper = join(root, `.mineru-preview-projection-${process.pid}.mjs`);
let projection;
const spans = (content) => [{ type: 'text', content }];
const markdown =
  '# Scope\n\nWARNING: Do not operate above 10 °C.\n\nException: use the alternate procedure.\n\n## Applicability\n\n- Remove the cover.\n- Keep AB-123 in place.\n\n<table><tr><th colspan="2">Operating limits</th></tr><tr><td>Maximum load</td><td>500</td></tr></table>\n\n![Diagram](images/diagram.png)\n\n## Verification\n\nConfirm all conditions before use.\n';
try {
  await build({
    stdin: {
      contents:
        "export {buildMineruReadingProjection} from './server/modules/professional-input/mineru/mineru-reading-projection'; export {readMineruArtifacts} from './server/modules/professional-input/mineru/mineru-artifacts';",
      resolveDir: root,
      loader: 'ts',
    },
    outfile: helper,
    bundle: true,
    packages: 'external',
    platform: 'node',
    format: 'esm',
  });
  const { buildMineruReadingProjection, readMineruArtifacts } = await import(
    pathToFileURL(helper).href
  );
  const blocks = [
    ['title', { level: 1, title_content: spans('Scope') }],
    [
      'paragraph',
      { paragraph_content: spans('WARNING: Do not operate above 10 °C.') },
    ],
    [
      'paragraph',
      { paragraph_content: spans('Exception: use the alternate procedure.') },
    ],
    ['title', { level: 2, title_content: spans('Applicability') }],
    [
      'list',
      {
        list_items: [
          { item_content: spans('Remove the cover.') },
          { item_content: spans('Keep AB-123 in place.') },
        ],
      },
    ],
    [
      'table',
      {
        html: '<table><tr><th colspan="2">Operating limits</th></tr><tr><td>Maximum load</td><td>500</td></tr></table>',
      },
    ],
    [
      'image',
      {
        image_source: { path: 'images/diagram.png' },
        image_caption: [],
        image_footnote: [],
      },
    ],
    ['title', { level: 2, title_content: spans('Verification') }],
    [
      'paragraph',
      { paragraph_content: spans('Confirm all conditions before use.') },
    ],
    [
      'page_footnote',
      {
        page_footnote_content: spans('Retain this meaningful exception note.'),
      },
    ],
    ['page_header', { page_header_content: spans('HEADER MUST NOT APPEAR') }],
  ].map(([type, content], index) => ({
    type,
    content,
    bbox: [10, 10 + index * 70, 900, 60 + index * 70],
  }));
  const doc = readMineruArtifacts({
    markdown,
    contentListV2: [blocks],
    middle: {
      _version_name: '3.4.5',
      _backend: 'pipeline',
      pdf_info: [{ page_idx: 0, page_size: [1000, 1000] }],
    },
    assetPaths: ['images/diagram.png'],
  });
  projection = buildMineruReadingProjection(doc, {
    documentVersionId: 'isolated-fixture',
    parseRunId: 'fixture-run',
  });
} finally {
  await unlink(helper);
}
const entry = `import React from 'react';import {createRoot} from 'react-dom/client';import {MineruMarkdownReader} from ${JSON.stringify(join(root, 'client/src/pages/DocumentParsingPage/MineruMarkdownReader.tsx'))};
createRoot(document.getElementById('app')).render(<MineruMarkdownReader markdown={${JSON.stringify(markdown)}} assets={{'images/diagram.png':'/diagram.svg'}} projection={${JSON.stringify(projection)}} onLocateSource={source=>{document.getElementById('result').textContent='Fixture source callback: '+source.blockId;document.getElementById('result').dataset.blockId=source.blockId;}}/>);`;
const watcher = await context({
  stdin: { contents: entry, resolveDir: root, loader: 'tsx' },
  outfile: join(output, 'reader.js'),
  bundle: true,
  platform: 'browser',
  format: 'esm',
  jsx: 'automatic',
  minify: true,
  loader: { '.woff': 'dataurl', '.woff2': 'dataurl', '.ttf': 'dataurl' },
  tsconfig: 'tsconfig.app.json',
  logLevel: 'warning',
});
await watcher.watch();
await watcher.rebuild();
await writeFile(
  join(output, 'index.html'),
  '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>MinerU 阅读器隔离交互测试</title><link rel="stylesheet" href="/reader.css"><style>*{box-sizing:border-box}body{margin:0;font-family:system-ui;color:#243248}header{height:70px;padding:10px 18px;background:#eff3f8;font-size:13px}#app{height:calc(100vh - 70px)}#result{font-size:12px;color:#315787}</style><header><strong>阅读器隔离交互测试 · 人工样本</strong><div id="result">原件定位回调尚未触发；此页不是业务文档。</div></header><div id="app"></div><script type="module" src="/reader.js"></script></html>',
);
await writeFile(
  join(output, 'diagram.svg'),
  '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="140" viewBox="0 0 600 140"><rect x="1" y="1" width="598" height="138" rx="12" fill="#edf4ff" stroke="#699bdc"/><text x="300" y="65" text-anchor="middle" font-size="22" fill="#204b81">Isolated image fixture</text><text x="300" y="98" text-anchor="middle" font-size="16" fill="#49698e">Resource mapping and source selection</text></svg>',
);
const names = new Set(['index.html', 'reader.js', 'reader.css', 'diagram.svg']);
const server = createServer(async (req, res) => {
  const path = new URL(req.url, 'http://127.0.0.1').pathname;
  const name = path === '/' ? 'index.html' : path.slice(1);
  if (!names.has(name)) {
    res.writeHead(404);
    res.end();
    return;
  }
  try {
    const data = await readFile(join(output, name));
    res.setHeader(
      'Content-Type',
      {
        '.html': 'text/html; charset=utf-8',
        '.js': 'text/javascript',
        '.css': 'text/css',
        '.svg': 'image/svg+xml',
      }[extname(name)],
    );
    res.end(data);
  } catch {
    res.writeHead(500);
    res.end();
  }
});
server.listen(0, '127.0.0.1', () =>
  console.log(
    JSON.stringify({
      url: `http://127.0.0.1:${server.address().port}`,
      fixture: true,
      pid: process.pid,
      output,
    }),
  ),
);
