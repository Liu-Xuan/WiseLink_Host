import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(__dirname, '../..');
const layoutSource = fs.readFileSync(
  path.join(root, 'client/src/components/Layout.tsx'),
  'utf8',
);
const shellCss = fs.readFileSync(
  path.join(root, 'client/src/components/app-shell.css'),
  'utf8',
);

describe('App chrome contextual navigation ownership', () => {
  it('uses one material owner and one contextual header without a second breadcrumb frame', () => {
    const chromeStart = layoutSource.indexOf(
      'className="wiselink-app-chrome wl-glass-nav"',
    );
    const headerStart = layoutSource.indexOf(
      '<header className="wiselink-app-header"',
      chromeStart,
    );
    const objectContextStart = layoutSource.indexOf(
      'className={`wiselink-object-context',
      headerStart,
    );
    const bodyStart = layoutSource.indexOf(
      '<div className="wiselink-app-body"',
      objectContextStart,
    );

    expect(chromeStart).toBeGreaterThan(-1);
    expect(headerStart).toBeGreaterThan(chromeStart);
    expect(objectContextStart).toBeGreaterThan(headerStart);
    expect(bodyStart).toBeGreaterThan(objectContextStart);
    expect(layoutSource).not.toContain('wiselink-breadcrumb');
    expect(layoutSource).toContain('<CurrentObjectContextProvider>');
    expect(layoutSource).toContain('currentObject.displayCode');
    expect(layoutSource).toContain('currentObject.statusLabel');
  });

  it('keeps sticky positioning and glass treatment on the outer chrome only', () => {
    expect(shellCss).toMatch(
      /\.wiselink-app-chrome\s*\{[\s\S]*?position: sticky;[\s\S]*?top: 10px;[\s\S]*?border-radius: 26px;/,
    );
    expect(shellCss).toMatch(
      /\.wiselink-app-header\s*\{[\s\S]*?border: 0;[\s\S]*?background: transparent;[\s\S]*?box-shadow: none;[\s\S]*?backdrop-filter: none;/,
    );
    expect(shellCss).toContain('.wiselink-object-context');
    expect(shellCss).toContain('.wiselink-object-context-sub');
  });

  it('preserves workbench and mobile height ownership on the chrome wrapper', () => {
    expect(shellCss).toMatch(
      /\.wiselink-app-shell\.is-workbench-route \.wiselink-app-chrome\s*\{[\s\S]*?position: relative;[\s\S]*?top: auto;[\s\S]*?margin-block: 0;/,
    );
    expect(shellCss).toMatch(
      /@media \(max-width: 720px\)[\s\S]*?\.wiselink-app-shell\.is-workbench-route \.wiselink-app-chrome\s*\{\s*display: none;/,
    );
    expect(shellCss).toMatch(
      /body\[data-wl-immersive='true'\] \.wiselink-app-chrome,[\s\S]*?\.wl-dock\s*\{\s*display: none;/,
    );
  });
});
