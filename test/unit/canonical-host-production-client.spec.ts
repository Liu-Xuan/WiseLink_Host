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
      resolve(
        clientSourceRoot,
        'pages/WorkspaceHomePage/WorkspaceHomePage.tsx',
      ),
      'utf8',
    );
    const app = await readFile(resolve(clientSourceRoot, 'app.tsx'), 'utf8');

    expect(home).toContain('资料目录');
    expect(home).toContain('进入工作台');
    expect(home).toContain(
      '/work-items/${encodeURIComponent(projection.workItemId)}/documents',
    );
    expect(app).toContain('work-items/:workItemId/documents');
  });

  it('composes P1-P4 from canonical Host read projections only', async () => {
    const [home, reader, workbench] = await Promise.all([
      readFile(
        resolve(
          clientSourceRoot,
          'pages/WorkspaceHomePage/WorkspaceHomePage.tsx',
        ),
        'utf8',
      ),
      readFile(
        resolve(
          clientSourceRoot,
          'pages/DocumentParsingPage/DocumentReaderWorkspace.tsx',
        ),
        'utf8',
      ),
      readFile(
        resolve(
          clientSourceRoot,
          'pages/DocumentParsingPage/DocumentParsingPage.tsx',
        ),
        'utf8',
      ),
    ]);

    expect(home).toContain('data.libraryIndex.nodes');
    expect(home).toContain('data.relatedDocuments.relations');
    expect(reader).toContain('data.readerProjection.units');
    expect(reader).toContain('result.sourceLocators');
    expect(reader).toContain('locator.pageStart');
    expect(reader).not.toContain('data.queryResults');
    expect(workbench).toContain('overallCandidate.overallCandidate');
    expect(workbench).toContain('overallCandidate.findings');
    expect(workbench).toContain('selectedReviewItem.factsConsidered');
    expect(workbench).toContain('selectedReviewItem.ruleApplication');
    expect(workbench).toContain('selectedReviewItem.analysisSummary');
    expect(workbench).toContain('selectedReviewItem.sourceRefs');
    expect(workbench).toContain('selectedReviewItem.missingInputs');
    expect(workbench).toContain("readerMode: 'structured'");
    expect(workbench).toContain('unit: null');
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
