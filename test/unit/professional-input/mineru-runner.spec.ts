import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
      const output = process.argv[process.argv.indexOf('-o') + 1];
      fs.mkdirSync(output, { recursive: true });
      fs.writeFileSync(path.join(output, 'document.md'), 'First paragraph.\\n\\nSecond paragraph.');
      fs.writeFileSync(path.join(output, 'document_middle.json'), JSON.stringify({_backend:'pipeline',_version_name:'3.4.5',pdf_info:[{page_idx:0,page_size:[612,792]}]}));
      fs.writeFileSync(path.join(output, 'document_content_list_v2.json'), JSON.stringify([[{type:'paragraph',bbox:[1,1,100,100],content:{paragraph_content:[{type:'text',content:'First paragraph.'}]}},{type:'paragraph',bbox:[1,110,100,200],content:{paragraph_content:[{type:'text',content:'Second paragraph.'}]}}]]));
    `);
    const runner = new MineruRunner({ executable, configPath });
    const pending = runner.parse(pdf);
    await expect(runner.parse(pdf)).rejects.toThrow('MINERU_BUSY');
    const result = await pending;
    expect(result.sourceByteLength).toBe(pdf.length);
    expect(result.sourceSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(result.document.blocks).toHaveLength(2);
    expect(result.rawArtifacts.markdown).toBe(result.document.markdown);
    expect(result.rawArtifacts.contentListV2).toEqual(result.contentListV2);
    expect(result.rawArtifacts.middle).toEqual(result.middle);
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
