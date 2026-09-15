import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { StaticRouter } from 'react-router-dom/server';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import OverviewSourceWork from '../../client/src/features/matter/OverviewSourceWork';
import MatterPosture from '../../client/src/features/matter/MatterPosture';
import { libraryMatterFixture } from './fixtures/library-matter';
jest.mock('@client/src/features/matter/matter-posture.css', () => ({}));

const source = { workRef: 'saved/work-exact', workingRevision: 6 };
function render(
  status?: 'CURRENT' | 'STALE' | 'NOT_AVAILABLE',
  saved: typeof source | null | undefined = source,
) {
  return renderToStaticMarkup(
    createElement(
      StaticRouter,
      { location: '/matters/MAT?workRef=historical-14' },
      createElement(OverviewSourceWork, {
        matterId: 'MAT/a',
        source: saved,
        overviewStatus: status,
      }),
    ),
  );
}
describe('exact overview SAVE provenance', () => {
  it.each(['CURRENT', 'STALE'] as const)(
    'uses the same receipt-bound work for %s, not the viewed work or latest',
    (status) => {
      const html = render(status);
      expect(html).toContain('工作修订 6');
      expect(html).toContain(
        '/matters/MAT%2Fa?panel=brief&amp;workRef=saved%2Fwork-exact',
      );
      expect(html).not.toContain('historical-14');
      expect(html).not.toContain('latest');
      expect(html).toContain('不代表批准或生成运行状态');
    },
  );
  it('treats explicit null and omitted provenance as unknown', () => {
    expect(render('CURRENT', null)).toContain('准确保存工作尚未核实');
    const html = renderToStaticMarkup(
      createElement(
        StaticRouter,
        { location: '/' },
        createElement(OverviewSourceWork, { matterId: 'M' }),
      ),
    );
    expect(html).toContain('准确保存工作尚未核实');
    expect(html).not.toContain('href=');
  });
  it('suppresses even a supplied provenance when the overview is not available', () => {
    expect(render('NOT_AVAILABLE')).toBe('');
  });
  it('supports summary-only historical work in posture and retains independent run uncertainty', () => {
    const data = libraryMatterFixture();
    data.working.current!.overviewSourceWork = source;
    const html = renderToStaticMarkup(
      createElement(
        StaticRouter,
        { location: '/' },
        createElement(MatterPosture, { data }),
      ),
    );
    expect(html).toContain('workRef=saved%2Fwork-exact');
    expect(html).toContain('普通生成运行状态尚未核实');
    expect(html).not.toContain('确切工作引用及普通生成运行状态尚未返回');
  });
  it('wires both search hits and expanded identity to their own provenance and retains historical selection', () => {
    const root = resolve(__dirname, '../../client/src/features/matter');
    const search = readFileSync(
      resolve(root, 'EngineeringIssueSearch.tsx'),
      'utf8',
    );
    expect(search).toContain('source={hit.overviewSourceWork}');
    expect(search).toContain('source={selected.identity.overviewSourceWork}');
    expect(search).toContain('综合认识尚未覆盖本次问题更新');
    const page = readFileSync(
      resolve(root, 'EngineeringMatterPage.tsx'),
      'utf8',
    );
    expect(page).toContain('source={displayedRevision.overviewSourceWork}');
    expect(page).not.toContain('source={currentRevision.overviewSourceWork}');
  });
});
