import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { StaticRouter } from 'react-router-dom/server';
import type { CanonicalLibraryQuicklookResponse } from '@shared/api.interface';
import { jobAidReadingResult } from '@shared/jobaid-problem-assessment.interface';
import { LibraryDocumentDetails } from '../../client/src/pages/WorkspaceHomePage/LibraryDocumentDetails';
import { libraryDocument, libraryFamily } from './fixtures/canonical-library';
import { jobAidReadingFixture } from './semantic-reading-ui.fixtures';

jest.mock('@client/src/api/canonical-host', () => ({
  getCanonicalHostClientSessionGeneration: () => 1,
  subscribeCanonicalHostClientSession: () => () => undefined,
}));
jest.mock('@client/src/components/ui/button', () => ({ Button: 'button' }));
jest.mock('@client/src/features/matter/LinkDocumentMatterMaterial', () => ({
  __esModule: true, default: () => null,
}));

function renderQuicklook(response: CanonicalLibraryQuicklookResponse) {
  const document = libraryFamily('787');
  document.versions[0]!.documentReading = { status: 'NOT_GENERATED', reading: null };
  return renderToStaticMarkup(createElement(StaticRouter, { location: '/library?familyId=787' },
    createElement(LibraryDocumentDetails, {
      document,
      assessmentQuicklook: { data: response, loading: false, error: null, accessDenied: false },
      onRefresh: jest.fn(), onViewTasks: jest.fn(),
    })));
}

describe('document library associated assessment', () => {
  it('shows a saved assessment only for the exact selected document version', () => {
    const response: CanonicalLibraryQuicklookResponse = {
      document: { ...libraryDocument('WI-NEW'), documentVersionId: 'DV-787-2' },
      result: { status: 'CANDIDATE_ONLY', revision: 2, sourceResultId: 'work-2',
        engineeringSummary: null, overallCandidate: null, missingInputs: [], gap: null,
        staleReason: null, sourceCount: 3, overallStatus: 'CURRENT',
        readingResult: jobAidReadingResult(jobAidReadingFixture().current!),
      },
      fileReadPerformed: false,
    };
    const correct = renderQuicklook(response);
    expect(correct).toContain('关联评估短认识');
    expect(correct).toContain(response.result!.readingResult!.content.listBrief);
    expect(correct).toContain('/work-items/WI-NEW/analysis?panel=assessment');
    expect(correct).toContain('文档自身解读尚未生成');

    const wrongVersion = renderQuicklook({ ...response, document: {
      ...response.document, documentVersionId: 'DV-787-1',
    } });
    expect(wrongVersion).not.toContain(response.result!.readingResult!.content.listBrief);
    expect(wrongVersion).not.toContain('/work-items/WI-NEW/analysis?panel=assessment');
  });
});
