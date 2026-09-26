import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { packageLocalMineruCandidate } from '../../../scripts/package-local-mineru-candidate';
import { readLocalMineruCandidate } from '../../../server/modules/document-management/src/hosted/nest/document-mineru-local-candidate';
import { MineruRunner } from '../../../server/modules/professional-input/mineru/mineru-runner';

// Fake executable tests process management and output handling, not model quality.
describe('MinerU runner process boundary (fixture executable)', () => {
  let root: string;
  let executable: string;
  let configPath: string;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'mineru-runner-test-'));
    executable = join(root, 'fixture.cjs');
    configPath = join(root, 'mineru.json');
    await writeFile(
      configPath,
      JSON.stringify({
        'model-source': 'local',
        'models-dir': { pipeline: '/models/pipeline' },
      }),
    );
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });
  const pdf = Buffer.from('%PDF-1.7\nfixture, not a real PDF parser test');
  async function script(body: string) {
    await writeFile(executable, `#!${process.execPath}\n${body}\n`, {
      mode: 0o700,
    });
  }
  it('binds exact input bytes, explicitly selects pipeline and preserves produced paragraphs', async () => {
    await script(`
      const fs = require('node:fs'); const path = require('node:path');
      if (process.argv[process.argv.indexOf('-b') + 1] !== 'pipeline' || process.env.MINERU_MODEL_SOURCE !== 'local') process.exit(2);
      if (process.env.LD_LIBRARY_PATH.split(':')[0] !== ${JSON.stringify(join(root, 'system-libs'))}) process.exit(3);
      if (process.env.WL_LOCAL_MINERU_API_KEY || process.env.OPENAI_API_KEY || process.env.HF_HUB_OFFLINE !== '1') process.exit(4);
      const output = process.argv[process.argv.indexOf('-o') + 1];
      fs.mkdirSync(output, { recursive: true });
      fs.writeFileSync(path.join(output, 'document.md'), 'First paragraph.\\n\\nSecond paragraph.');
      fs.writeFileSync(path.join(output, 'document_middle.json'), JSON.stringify({_backend:'pipeline',_version_name:'3.4.5',pdf_info:[{page_idx:0,page_size:[612,792]}]}));
      fs.writeFileSync(path.join(output, 'document_content_list_v2.json'), JSON.stringify([[{type:'paragraph',bbox:[1,1,100,100],content:{paragraph_content:[{type:'text',content:'First paragraph.'}]}},{type:'paragraph',bbox:[1,110,100,200],content:{paragraph_content:[{type:'text',content:'Second paragraph.'}]}}]]));
    `);
    const runner = new MineruRunner({ executable, configPath, libraryPath: join(root, 'system-libs') });
    const oldKey = process.env.WL_LOCAL_MINERU_API_KEY;
    process.env.WL_LOCAL_MINERU_API_KEY = 'isolated-secret-never-child';
    const pending = runner.parse(pdf).finally(() => {
      if (oldKey === undefined) delete process.env.WL_LOCAL_MINERU_API_KEY; else process.env.WL_LOCAL_MINERU_API_KEY = oldKey;
    });
    await expect(runner.parse(pdf)).rejects.toThrow('MINERU_BUSY');
    const result = await pending;
    expect(result.sourceByteLength).toBe(pdf.length);
    expect(result.sourceSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(result.document.blocks).toHaveLength(2);
    expect(result.rawArtifacts.markdown).toBe(result.document.markdown);
    expect(result.rawArtifacts.contentListV2).toEqual(result.contentListV2);
    expect(result.rawArtifacts.middle).toEqual(result.middle);
    const candidate = packageLocalMineruCandidate({ pdf,
      parser: { version: result.document.version, backend: result.document.backend },
      raw: result.rawArtifacts, assets: result.assets });
    const readback = readLocalMineruCandidate(candidate);
    expect(readback.sourceSha256).toBe(result.sourceSha256);
    expect(readback.sourceByteLength).toBe(pdf.length);
    expect(readback.rawArtifacts).toEqual(result.rawArtifacts);
    expect(readback.titleEnhancement).toBeUndefined();
    expect(result.document.markdown).toBe(
      'First paragraph.\n\nSecond paragraph.',
    );
  });
  it('terminates a hung process and remains usable after the failure', async () => {
    await script('setInterval(() => {}, 1000);');
    const runner = new MineruRunner({
      executable,
      configPath,
      timeoutMs: 1500,
    });
    await expect(runner.parse(pdf)).rejects.toThrow('MINERU_TIMEOUT');
    await script('process.exit(7);');
    await expect(runner.parse(pdf)).rejects.toThrow('MINERU_PROCESS_FAILED:7');
  });
  it('kills the owned child after lease cancellation, including a child that ignores TERM', async () => {
    const marker = join(root, 'child.pid');
    await script(`const fs = require('node:fs');
      process.on('SIGTERM', () => {});
      fs.writeFileSync(${JSON.stringify(marker)}, String(process.pid));
      setInterval(() => {}, 1000);`);
    const controller = new AbortController();
    const runner = new MineruRunner({ executable, configPath });
    const pending = runner.parse(pdf, { signal: controller.signal });
    const rejected = expect(pending).rejects.toThrow('MINERU_ABORTED');
    let pid: number | undefined;
    for (let attempt = 0; attempt < 100; attempt++) {
      try { pid = Number(await readFile(marker, 'utf8')); break; }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    expect(pid).toBeGreaterThan(0);
    controller.abort();
    await rejected;
    expect(() => process.kill(pid!, 0)).toThrow();
    await script('process.exit(7);');
    await expect(runner.parse(pdf)).rejects.toThrow('MINERU_PROCESS_FAILED:7');
  });
  it('rejects a previously cancelled lease before spawning any child', async () => {
    const controller = new AbortController(); controller.abort();
    await expect(new MineruRunner({ executable, configPath }).parse(pdf, { signal: controller.signal }))
      .rejects.toThrow('MINERU_ABORTED');
  });
  it('passes a fixed entry script to the selected interpreter without a shell', async () => {
    const entryScript = join(root, 'selected-entry.cjs');
    await writeFile(entryScript, "if (process.argv.slice(2).includes('-b') && process.argv.at(-1) === 'pipeline') process.exit(9); process.exit(8);");
    await expect(new MineruRunner({ executable: process.execPath, entryScript, configPath }).parse(pdf))
      .rejects.toThrow('MINERU_PROCESS_FAILED:9');
    await expect(new MineruRunner({ executable: process.execPath, entryScript: 'relative.py', configPath }).parse(pdf))
      .rejects.toThrow('MINERU_RUNTIME_CONFIG_INVALID');
  });
  it('does not accept an external model source or an implicit title endpoint', async () => {
    await writeFile(
      configPath,
      JSON.stringify({ 'model-source': 'huggingface' }),
    );
    await expect(
      new MineruRunner({ executable, configPath }).parse(pdf),
    ).rejects.toThrow('LOCAL_MODEL_CONFIG_REQUIRED');
  });
});
