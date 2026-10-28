const request = jest.fn();
jest.mock('@lark-apaas/client-toolkit/utils/getAxiosForBackend', () => ({ axiosForBackend: request }));
jest.mock('@lark-apaas/client-toolkit/utils/resolveAppUrl', () => ({ resolveAppUrl: (path: string) => path }));
jest.mock('@lark-apaas/client-toolkit/logger', () => ({ logger: { error: jest.fn() } }));

import { invalidateCanonicalHostClientSession, readTdmsDocumentObservedLinks } from '@client/src/api/canonical-host';
import type { TdmsDocumentObservedLinksRequest, TdmsDocumentObservedLinksResponse } from '@shared/tdms-source-reading.interface';
import { observedFixture } from './tdms-observed-links.fixture';

describe('observed association browser API contract', () => {
  let input: TdmsDocumentObservedLinksRequest, response: TdmsDocumentObservedLinksResponse;
  beforeAll(async () => {
    const f = await observedFixture(), dv = f.registration.documentVersionId!;
    const first = await f.controller.documentObservedLinks(f.request, dv, { root: f.rootRef });
    const parent = first.links[0].child.record.sourceRevisionRef;
    input = { documentVersionId: dv, rootRevisionRef: f.rootRef, parentPath: [parent], limit: 12 };
    response = await f.controller.documentObservedLinks(f.request, dv, { root: f.rootRef, parent, limit: '12' });
  });
  beforeEach(() => { invalidateCanonicalHostClientSession(); request.mockReset(); });

  it('sends the exact DVI, root and path and preserves each own read', async () => {
    request.mockResolvedValue({ status: 200, data: response });
    const result = await readTdmsDocumentObservedLinks(input);
    const query = new URLSearchParams({ root: input.rootRevisionRef });
    query.append('parent', input.parentPath![0]); query.set('limit', '12');
    expect(request).toHaveBeenCalledWith({ method: 'GET', signal: undefined,
      url: `/api/tdms-source/document-versions/${encodeURIComponent(input.documentVersionId)}/observed-links?${query}` });
    expect(result.links).toHaveLength(2);
    expect(result.links.find(link => link.child.bodyReadPolicy?.kind === 'METADATA_ONLY')?.child.record.content).toEqual({});
  });

  it.each(['document', 'receipt'] as const)('rejects a mismatched %s binding', async mismatch => {
    const bad = structuredClone(response);
    if (mismatch === 'document') bad.documentVersionId = 'OTHER-DOCUMENT-VERSION';
    else bad.links[0].child.receipt.sourceRevisionRef = 'OTHER-REVISION';
    request.mockResolvedValue({ status: 200, data: bad });
    await expect(readTdmsDocumentObservedLinks(input)).rejects.toThrow('TDMS_OBSERVED_ASSOCIATION_BINDING_MISMATCH');
  });

  it('does not release an old response after the session generation changes', async () => {
    let release!: (value: unknown) => void;
    request.mockReturnValue(new Promise(resolve => { release = resolve; }));
    const pending = readTdmsDocumentObservedLinks(input);
    invalidateCanonicalHostClientSession();
    release({ status: 200, data: response });
    await expect(pending).rejects.toThrow('TDMS_SOURCE_READ_OBSOLETE');
  });
});
