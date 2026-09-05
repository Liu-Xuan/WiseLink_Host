import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(__dirname, '../..');

describe('UI-N02 Silver / Carbon Satin workspace', () => {
  it('uses neutral primary materials and keeps semantic state colors separate', async () => {
    const tokens = await readFile(
      resolve(root, 'client/src/styles/tokens.css'),
      'utf8',
    );

    expect(tokens).toContain('--wl-bg: #dedede;');
    expect(tokens).toContain('--wl-frame-solid: #ededed;');
    expect(tokens).toContain('--wl-sheet: #ffffff;');
    expect(tokens).toContain('--wl-well: #e5e5e5;');
    expect(tokens).toContain('--wl-bg: #101010;');
    expect(tokens).toContain('--wl-sheet: #252525;');
    expect(tokens).toContain('--wl-well: #191919;');
    expect(tokens).toContain('--wl-green: #25b86b;');
    expect(tokens).toContain('--wl-amber: #f2a23a;');
    expect(tokens).toContain('--wl-red: #e85a62;');
  });

  it('keeps the environment static and compatible mode blur-free', async () => {
    const glass = await readFile(
      resolve(root, 'client/src/styles/glass.css'),
      'utf8',
    );

    expect(glass).toMatch(/\.wl-ambient-field,\s*\.wl-light\s*\{[\s\S]*?display: none;/u);
    expect(glass).toMatch(
      /data-wl-visual-mode='compatible'[\s\S]*?\.wl-review-impact-backdrop[\s\S]*?backdrop-filter: none !important;/u,
    );
  });

  it('uses the required desktop widths and releases auxiliary panes on small screens', async () => {
    const [workspace, workbench] = await Promise.all([
      readFile(
        resolve(
          root,
          'client/src/pages/WorkspaceHomePage/workspace-home.css',
        ),
        'utf8',
      ),
      readFile(
        resolve(
          root,
          'client/src/features/workbench/WorkbenchShell.tsx',
        ),
        'utf8',
      ),
    ]);

    expect(workspace).toContain('grid-template-columns: minmax(0, 1fr) 324px;');
    expect(workspace).toMatch(
      /@media \(max-width: 980px\)[\s\S]*?\.library-surface\.has-projection[\s\S]*?grid-template-columns: minmax\(0, 1fr\);/u,
    );
    expect(workbench).toContain('const EVIDENCE_DEFAULT = 326;');
    expect(workbench).toContain('initialPrefs.navCollapsed ?? true');
  });

  it('keeps structured source units in one continuous reading sheet', async () => {
    const css = await readFile(
      resolve(
        root,
        'client/src/pages/DocumentParsingPage/structured-content-browser.css',
      ),
      'utf8',
    );

    expect(css).toMatch(
      /\.structured-browser-units\s*\{[\s\S]*?background: var\(--wl-sheet\);/u,
    );
    expect(css).toMatch(
      /\.structured-browser-unit\s*\{[\s\S]*?border-radius: 0;[\s\S]*?box-shadow: none;/u,
    );
    expect(css).toContain(".structured-browser-unit[data-display-kind='section']");
  });
});
