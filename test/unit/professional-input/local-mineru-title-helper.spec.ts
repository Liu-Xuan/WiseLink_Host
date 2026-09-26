import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { localMineruTitleCall, runLocalMineruTitleEnhancement } from '../../../scripts/local-mineru-title-helper';
const config = { enable: true, base_url: 'http://127.0.0.1:4000/v1', model: 'wiselink-mineru-title-dli' };
const titles = [{ id: 'page-1-block-1', text: 'Synthetic scope', lineHeight: 20, page: 1 }];
const levels = { levels: [{ id: 'page-1-block-1', level: 1 }] };
const response = () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(levels) } }] }));
describe('local title-only proxy helper (no network)', () => {
  afterEach(() => jest.restoreAllMocks());
  it('sends only allowlisted heading fields to the existing loopback alias and rejects redirects', async () => {
    const request = jest.fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>().mockResolvedValue(response());
    const call = localMineruTitleCall(config, request);
    expect(await call(titles)).toEqual(levels);
    const [url, options] = request.mock.calls[0];
    expect(url).toBe('http://127.0.0.1:4000/v1/chat/completions');
    expect(options?.redirect).toBe('error');
    const body = JSON.parse(String(options?.body));
    expect(JSON.parse(body.messages[1].content)).toEqual(titles);
    expect(body.model).toBe(config.model);
  });
  it('rejects disabled or changed provider configuration before making a request', () => {
    expect(() => localMineruTitleCall({ ...config, enable: false })).toThrow('DISABLED');
    expect(() => localMineruTitleCall({ ...config, base_url: 'https://unapproved.test/v1' })).toThrow('CONFIG_MISMATCH');
    expect(() => localMineruTitleCall({ ...config, model: 'other-model' })).toThrow('CONFIG_MISMATCH');
  });
  it('reports status-only upstream errors without copying sensitive error bodies', async () => {
    const request = jest.fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>().mockResolvedValue(new Response('secret upstream body', { status: 401 }));
    await expect(localMineruTitleCall(config, request)(titles)).rejects.toThrow('LOCAL_TITLE_PROXY_HTTP_401');
  });
  it('preserves raw files, records APPLIED, and retains strict validation on bad model output', async () => {
    const root = await mkdtemp(join(tmpdir(), 'wl-title-test-'));
    try {
      const md = '# Synthetic scope\n\nUntouched source body.\n';
      const middle = { _version_name: '3.0.9', _backend: 'pipeline', pdf_info: [{
        page_idx: 0, page_size: [1000, 1000], para_blocks: [{ type: 'title', bbox: [10, 20, 200, 40], level: 1 }],
      }] };
      const v2 = [[{ type: 'title', bbox: [10, 20, 200, 40], content: {
        level: 1, title_content: [{ type: 'text', content: 'Synthetic scope' }],
      } }]];
      await Promise.all([
        writeFile(join(root, 'source.md'), md),
        writeFile(join(root, 'source_middle.json'), JSON.stringify(middle)),
        writeFile(join(root, 'source_content_list_v2.json'), JSON.stringify(v2)),
        writeFile(join(root, 'config.json'), JSON.stringify({ 'llm-aided-config': { title_aided: config } })),
      ]);
      const request = jest.spyOn(globalThis, 'fetch').mockResolvedValue(response());
      const applied = await runLocalMineruTitleEnhancement(root, 'source', join(root, 'success'), join(root, 'config.json'));
      expect(applied.titleEnhancement).toEqual({ status: 'APPLIED', levels: levels.levels,
        provider: { model: config.model, endpointOrigin: 'http://127.0.0.1:4000' } });
      expect(applied.rawUnchanged).toBe(true);
      expect(String(request.mock.calls[0][1]?.body)).not.toContain('Untouched source body');
      expect(await readFile(join(root, 'source.md'), 'utf8')).toBe(md);
      request.mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: '{"levels":[{"id":"wrong","level":1}]}' } }] })));
      const failed = await runLocalMineruTitleEnhancement(root, 'source', join(root, 'failure'), join(root, 'config.json'));
      expect(failed.titleEnhancement).toEqual({ status: 'FAILED', code: 'TITLE_OUTPUT_INVALID' });
      expect(failed.titleEnhancement).not.toHaveProperty('levels');
      expect(await readFile(join(root, 'source_middle.json'), 'utf8')).toBe(JSON.stringify(middle));
      await expect(readFile(join(root, 'failure', 'reading.md'))).rejects.toMatchObject({ code: 'ENOENT' });
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});
