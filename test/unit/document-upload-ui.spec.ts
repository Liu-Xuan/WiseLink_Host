import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { DocumentUploadResponse } from '@shared/api.interface';
import { DocumentUploadReceipt } from '../../client/src/pages/WorkspaceHomePage/DocumentUploadReceipt';

jest.mock('@client/src/components/ui/button', () => ({ Button: 'button' }));
jest.mock('@client/src/api/canonical-host', () => ({ getCanonicalHostClientSessionGeneration: () => 1 }));

jest.mock('@lark-apaas/client-toolkit/utils/resolveAppUrl', () => ({
  resolveAppUrl: (path: string) => `/app/test${path}`,
}));

const receipt: DocumentUploadResponse = {
  status: 'REVIEW_REQUIRED', identity: { documentNumber: 'SB-1', documentFamily: 'SB', issuerAuthority: null, businessRevision: 'R1', revisionDate: '2025-01-01', sourceGeneratedDate: '', pageCount: 2 },
  currentVersion: { documentVersionId: 'current', access: 'NOT_AUTHORIZED', identity: { documentNumber: 'HIDDEN-CURRENT', documentFamily: 'SB', issuerAuthority: null, businessRevision: 'R9', revisionDate: '', sourceGeneratedDate: '', pageCount: 2 } },
  disposition: 'REVIEW_REQUIRED', decision: 'ASK_IMPORT_OLDER_REVISION', preflightId: 'P1', documentVersionId: null, familyId: 'F1', newDocumentVersionCreated: false, currentnessChanged: false, reason: 'Older revision',
  historicalImport: { preflightId: 'P1', expectedCurrentGeneration: 9, expectedCurrentDocumentVersionId: 'current' },
};

describe('ordinary document upload receipt', () => {
  it('shows incoming revision but does not leak unreadable current-version identity', () => {
    const html = renderToStaticMarkup(createElement(DocumentUploadReceipt, { receipt }));
    expect(html).toContain('R1');
    expect(html).toContain('当前版本详情不可见');
    expect(html).not.toContain('HIDDEN-CURRENT');
    expect(html).not.toContain('R9');
    expect(html).toContain('不替换当前版本');
    expect(html).not.toContain('/original');
  });

  it('links the exact registered original without inventing an evaluation task', () => {
    const html = renderToStaticMarkup(createElement(DocumentUploadReceipt, { receipt: { ...receipt, status: 'COMMITTED', documentVersionId: 'DV/one', historicalImport: null } }));
    expect(html).toContain('data-document-version-id="DV/one"');
    expect(html).toContain('读取原件以预览');
    expect(html).not.toContain('href=');
    expect(html).not.toContain('/original');
    expect(html).toContain('已复用已保存的文档版本');
    expect(html).toContain('当前版本未改变');
    expect(html).toContain('没有创建评估任务');
    expect(html).not.toContain('/work-items/');
  });
});
