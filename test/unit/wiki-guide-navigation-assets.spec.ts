import { resolve } from 'node:path';

type GuideModule = typeof import('../../server/modules/canonical-host/hierarchical-wiki-navigation');
const modulePath = '../../server/modules/canonical-host/hierarchical-wiki-navigation';
const filename = 'library-ata-titles.generated.json';
const packaged = resolve(__dirname, '../../server/runtime-assets/wiki-guide', filename);
const source = resolve(process.cwd(), 'client/src/pages/WorkspaceHomePage', filename);
const titles = JSON.stringify({ schemes: { ispec: {
  chapters: [{ code: '31', titleZH: '指示/记录系统', titleEN: 'INDICATING/RECORDING SYSTEMS' }],
  expanded: [{ code: '31-10', titleZH: '仪表和控制面板', titleEN: 'Instruments and Control Panels' }],
} } });

function load(read: jest.Mock<string, [string, string]>): GuideModule {
  jest.doMock('node:fs', () => ({ ...jest.requireActual<typeof import('node:fs')>('node:fs'), readFileSync: read }));
  let loaded: GuideModule | undefined;
  jest.isolateModules(() => { loaded = jest.requireActual<GuideModule>(modulePath); });
  if (!loaded) throw new Error('test module did not load');
  return loaded;
}

describe('Wiki guide fixed packaged title asset loading', () => {
  afterEach(() => { jest.dontMock('node:fs'); jest.resetModules(); });

  it('prefers the server-relative package asset and reads it only at module initialization', () => {
    const read = jest.fn<string, [string, string]>((path, encoding) => {
      expect(path).toBe(packaged);
      expect(encoding).toBe('utf8');
      return titles;
    });
    const guide = load(read);
    expect(guide.wikiGuideChapterTitleCodes('记录').ata2).toEqual(['31']);
    expect(guide.wikiGuideChapterTitleCodes('Control Panels').ata4).toEqual(['31-10']);
    expect(read).toHaveBeenCalledTimes(1);
    expect(read).not.toHaveBeenCalledWith(source, 'utf8');
  });

  it('tries only the fixed development source after an absent packaged asset', () => {
    const missing = Object.assign(new Error('missing packaged file'), { code: 'ENOENT' });
    const read = jest.fn<string, [string, string]>((path) => {
      if (path === packaged) throw missing;
      expect(path).toBe(source);
      return titles;
    });
    expect(load(read).wikiGuideChapterTitleCodes('仪表和控制面板').ata4).toEqual(['31-10']);
    expect(read.mock.calls).toEqual([[packaged, 'utf8'], [source, 'utf8']]);
  });

  it.each(['EACCES', 'ENOTDIR'])('does not mask %s as a missing asset or try a second source', code => {
    const failure = Object.assign(new Error('packaged asset read failed'), { code });
    const read = jest.fn<string, [string, string]>(() => { throw failure; });
    expect(() => load(read)).toThrow(failure);
    expect(read.mock.calls).toEqual([[packaged, 'utf8']]);
  });

  it('does not swallow malformed packaged JSON and fall through to the source catalogue', () => {
    const read = jest.fn<string, [string, string]>(() => '{broken json');
    expect(() => load(read)).toThrow(SyntaxError);
    expect(read.mock.calls).toEqual([[packaged, 'utf8']]);
  });

  it('reports the missing asset after the two fixed paths without searching directories', () => {
    const read = jest.fn<string, [string, string]>(() => { throw Object.assign(new Error('absent'), { code: 'ENOENT' }); });
    expect(() => load(read)).toThrow('WIKI_GUIDE_RUNTIME_ASSET_NOT_PACKAGED:' + filename);
    expect(read.mock.calls).toEqual([[packaged, 'utf8'], [source, 'utf8']]);
  });
});
