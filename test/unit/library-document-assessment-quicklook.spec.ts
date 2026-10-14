import { createElement, type AnchorHTMLAttributes } from 'react';
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
jest.mock('@lark-apaas/client-toolkit/components/UniversalLink', () => ({
  UniversalLink: ({ to, ...props }: AnchorHTMLAttributes<HTMLAnchorElement> & { to: string }) =>
    createElement('a', { ...props, href: to }),
}));
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
    expect(correct).toContain('关联工程评估');
    expect(correct).toContain(response.result!.readingResult!.content.listBrief);
    expect(correct).toContain('/work-items/WI-NEW/analysis?panel=assessment');
    expect(correct).toContain('文档解读');
    expect(correct).toContain('暂无已保存解读');
    expect(correct).not.toContain('关联评估单独显示');

    const wrongVersion = renderQuicklook({ ...response, document: {
      ...response.document, documentVersionId: 'DV-787-1',
    } });
    expect(wrongVersion).not.toContain(response.result!.readingResult!.content.listBrief);
    expect(wrongVersion).not.toContain('/work-items/WI-NEW/analysis?panel=assessment');
  });
});

it('opens the exact selected historical document neighborhood rather than the family current version or a default matter', () => {
  const family=libraryFamily('787');
  const old=family.versions[1];
  const html=renderToStaticMarkup(createElement(StaticRouter,{location:`/library?selectedDocumentVersionId=${old.documentVersionId}`},
    createElement(LibraryDocumentDetails,{document:family,assessmentQuicklook:{data:null,loading:false,error:null,accessDenied:false},onRefresh:jest.fn(),onViewTasks:jest.fn()})));
  expect(html).toContain(`scope=document&amp;documentVersionId=${old.documentVersionId}&amp;readerWorkItemId=${old.readerWorkItemId}`);
  expect(html).toContain('文档关系图谱与时间');
});
