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

describe('App chrome layout ownership', () => {
  it('uses one material owner around the title row and breadcrumb row', () => {
    const chromeStart = layoutSource.indexOf(
      'className={`wiselink-app-chrome wl-glass-nav',
    );
    const headerStart = layoutSource.indexOf(
      '<header className="wiselink-app-header"',
      chromeStart,
    );
    const breadcrumbStart = layoutSource.indexOf(
      '<nav className="wiselink-breadcrumb"',
      headerStart,
    );
    const bodyStart = layoutSource.indexOf(
      '<div className="wiselink-app-body"',
      breadcrumbStart,
    );

    expect(chromeStart).toBeGreaterThan(-1);
    expect(headerStart).toBeGreaterThan(chromeStart);
    expect(breadcrumbStart).toBeGreaterThan(headerStart);
    expect(bodyStart).toBeGreaterThan(breadcrumbStart);
    expect(layoutSource).not.toContain(
      'className="wiselink-app-header wl-glass-nav"',
    );
    expect(layoutSource).not.toContain(
      '<nav className="wiselink-breadcrumb wl-glass-nav"',
    );
  });

  it('keeps sticky positioning and glass treatment on the outer chrome only', () => {
    expect(shellCss).toMatch(
      /\.wiselink-app-chrome\s*\{[\s\S]*?position: sticky;[\s\S]*?top: 12px;[\s\S]*?border-radius: var\(--wl-radius-shell\);/,
    );
    expect(shellCss).toMatch(
      /\.wiselink-app-header\s*\{[\s\S]*?border: 0;[\s\S]*?background: transparent;[\s\S]*?box-shadow: none;[\s\S]*?backdrop-filter: none;/,
    );
    expect(shellCss).toMatch(
      /\.wiselink-breadcrumb\s*\{[\s\S]*?border: 0;[\s\S]*?border-top: 1px solid[\s\S]*?border-radius: 0;[\s\S]*?background: transparent;[\s\S]*?box-shadow: none;/,
    );
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
