import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('Trinity matter Wiki layout', () => {
  const root = resolve(__dirname, '../../client/src/features/matter');
  const page = readFileSync(resolve(root, 'EngineeringMatterPage.tsx'), 'utf8');
  const css = readFileSync(resolve(root, 'matter-wiki.css'), 'utf8');

  it('keeps one saved matter result as the article and preserves its source/currentness readers', () => {
    expect(page).toContain('<AssessmentReadingBrief');
    expect(page).toContain('<MatterProblemWork');
    expect(page).toContain('<OverviewSourceWork');
    expect(page).toContain('source={displayedRevision.overviewSourceWork}');
    expect(page).not.toContain('source={currentRevision.overviewSourceWork}');
  });

  it('uses a stable article and evidence/work inspector that collapse to one column', () => {
    expect(page).toContain('matter-wiki-article');
    expect(page).toContain('matter-wiki-inspector');
    expect(css).toContain('grid-template-columns: minmax(0, 1fr) minmax(260px, 292px)');
    expect(css).toContain('@media (max-width: 899px)');
    expect(css).toContain('grid-template-columns: minmax(0, 1fr)');
  });
});
