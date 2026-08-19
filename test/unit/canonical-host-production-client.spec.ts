import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const clientSourceRoot = resolve(__dirname, '../../client/src');

describe('canonical Host production client boundary', () => {
  it('does not expose the development WorkItem creation route or API', async () => {
    const source = (await collectSourceFiles(clientSourceRoot)).join('\n');
    const normalizedSource = source.toLowerCase();

    expect(normalizedSource).not.toContain('development-runs');
    expect(normalizedSource).not.toContain('createworkitemfromdocumentversion');
    expect(source).not.toContain('创建开发 WorkItem');
    expect(source).not.toContain('从受控 DocumentVersion 创建开发事项');
  });

  it('keeps the library-first navigation and WorkItem deep link', async () => {
    const home = await readFile(
      resolve(clientSourceRoot, 'pages/WorkspaceHomePage/WorkspaceHomePage.tsx'),
      'utf8',
    );
    const app = await readFile(resolve(clientSourceRoot, 'app.tsx'), 'utf8');

    expect(home).toContain('资料目录');
    expect(home).toContain('进入工作台');
    expect(home).toContain('/work-items/${encodeURIComponent(projection.workItemId)}/documents');
    expect(app).toContain('work-items/:workItemId/documents');
  });
});

async function collectSourceFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = resolve(directory, entry.name);
      if (entry.isDirectory()) return collectSourceFiles(entryPath);
      return [await readFile(entryPath, 'utf8')];
    }),
  );
  return files.flat();
}
