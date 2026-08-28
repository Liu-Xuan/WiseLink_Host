import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const clientSourceRoot = resolve(__dirname, '../../client/src');

describe('canonical Host production client boundary', () => {
  it('exposes only the hosted DEV FileService upload/create/readback entry', async () => {
    const [api, intake, reparse, home] = await Promise.all([
      readFile(resolve(clientSourceRoot, 'api/canonical-host.ts'), 'utf8'),
      readFile(
        resolve(
          clientSourceRoot,
          'pages/WorkspaceHomePage/HostedDevelopmentIntake.tsx',
        ),
        'utf8',
      ),
      readFile(
        resolve(
          clientSourceRoot,
          'pages/WorkspaceHomePage/reparse-completed-work-item.ts',
        ),
        'utf8',
      ),
      readFile(
        resolve(
          clientSourceRoot,
          'pages/WorkspaceHomePage/WorkspaceHomePage.tsx',
        ),
        'utf8',
      ),
    ]);

    expect(api).toContain('/api/canonical-host/work-items/development-runs');
    expect(api).toContain('retry-development-run');
    expect(api).toContain('CANONICAL_DEVELOPMENT_WORK_ITEM_CREATE_FAILED');
    expect(intake).toContain('wiselink/dev-intake/');
    expect(intake).toContain('uploadFile');
    expect(intake).toContain('upsert: false');
    expect(intake).toContain('createDevelopmentWorkItem');
    expect(intake).toContain('requireOfficialOauthSession');
    expect(intake).toContain('getDocumentParsingPage');
    expect(intake).toContain('developmentRunToken');
    expect(intake).toContain('crypto.subtle.digest');
    expect(intake).toContain("'SHA-256'");
    expect(intake).toContain('sourceFileSha256');
    expect(intake).toContain('sourceByteLength');
    expect(home).toContain('HostedDevelopmentIntake');
    expect(home).toContain('retryDevelopmentWorkItem');
    expect(reparse).toContain("failureCode === 'SOURCE_BINDING_FAILED'");
    expect(reparse).toContain("projection.phase === 'PARSE_REQUESTED'");
    expect(reparse).toContain(
      "projection.phase === 'CANDIDATE_READBACK_VERIFIED'",
    );
    expect(reparse).toContain('assertSameWorkItemReparseReadback');
    expect(home).toContain('继续解析');
    expect(home).toContain('重新解析');
    expect(home).not.toContain('localStorage');
    expect(home).toContain('identity.developmentIntakeAvailable === true');
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
    expect(workbench).toContain('overallCandidate?.engineeringSummary');
    expect(workbench).toContain('overallEngineeringSummary?.conclusion.text');
    expect(workbench).not.toContain('overallCandidate.overallCandidate');
    expect(workbench).toContain('selectedReviewItem.factsConsidered');
    expect(workbench).toContain('selectedReviewItem.ruleApplication');
    expect(workbench).toContain('selectedReviewItem.analysisSummary');
    expect(workbench).toContain('selectedReviewItem.sourceRefs');
    expect(workbench).toContain('selectedReviewItem.missingInputs');
    expect(workbench).toContain("readerMode: 'structured'");
    expect(workbench).toContain('unit: null');
  });
});
