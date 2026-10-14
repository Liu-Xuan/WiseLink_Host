import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { JSDOM } from 'jsdom';
import { configurationRecord, snapshot, sourceRead } from './fixtures';

let sessionGeneration = 1;
const sourcePage = jest.fn();
const sourceHistory = jest.fn();
const sourceRecord = jest.fn();
const sourceRelations = jest.fn();
const lcmCatalogue = jest.fn();
const lcmRows = jest.fn();

jest.mock('@client/src/api/canonical-host', () => ({
  getCanonicalHostClientSessionGeneration: () => sessionGeneration,
  subscribeCanonicalHostClientSession: () => () => undefined,
  isCanonicalHostClientSessionAuthenticationRequired: () => false,
  readTdmsDocumentSource: (...args: unknown[]) => sourcePage(...args),
  readTdmsSourceHistory: (...args: unknown[]) => sourceHistory(...args),
  readTdmsSourceRecord: (...args: unknown[]) => sourceRecord(...args),
  readTdmsSourceRelations: (...args: unknown[]) => sourceRelations(...args),
  readLcmSourceSnapshots: (...args: unknown[]) => lcmCatalogue(...args),
  readLcmSourceSnapshotRows: (...args: unknown[]) => lcmRows(...args),
}));
jest.mock('@client/src/app/providers/CurrentUserSessionProvider', () => ({
  useCurrentUserSession: () => ({ authenticationRequired: false, sessionGeneration }),
}));
jest.mock('@client/src/components/ui/button', () => ({ Button: 'button' }));
jest.mock('@client/src/components/ui/input', () => ({ Input: 'input' }));

import { TdmsDocumentSourceReading } from '@client/src/features/tdms-source/TdmsDocumentSourceReading';
import { LcmConfigurationLibrary } from '@client/src/pages/WorkspaceHomePage/LcmConfigurationLibrary';

describe('source reading uses selected pages and user-triggered expansion', () => {
  let dom: JSDOM;
  let root: Root;
  let container: HTMLDivElement;
  const originals = new Map<string, PropertyDescriptor | undefined>();

  beforeEach(() => {
    dom = new JSDOM('<!doctype html><body></body>', { url: 'https://test.invalid/library' });
    for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document,
      navigator: dom.window.navigator, HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true })) {
      originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
      Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
    }
    container = dom.window.document.createElement('div');
    dom.window.document.body.append(container);
    root = createRoot(container);
    sessionGeneration = 1;
    [sourcePage, sourceHistory, sourceRecord, sourceRelations, lcmCatalogue, lcmRows].forEach(mock => mock.mockReset());
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    dom.window.close();
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
    originals.clear();
  });

  async function mountSource(versionId: string): Promise<void> {
    await act(async () => root.render(createElement(MemoryRouter, { future: { v7_startTransition: true, v7_relativeSplatPath: true } },
      createElement(TdmsDocumentSourceReading, { documentVersionId: versionId }))));
  }

  it('reads one selected-version page, keeps both approved professions and does not read collapsed history/relations', async () => {
    const approved = sourceRead('approved', 'DV-OLD');
    const sibling = sourceRead('unapproved', 'DV-OLD', 'Estimating');
    sibling.record.content.opinions![0].text = 'DRAFT_MARKER_MUST_NOT_RENDER';
    sourcePage.mockResolvedValue({ documentVersionId: 'DV-OLD', sourceStatus: 'AVAILABLE',
      records: [approved, sibling], hasMore: true, nextAfter: 'next-page' });
    await mountSource('DV-OLD');
    expect(sourcePage).toHaveBeenCalledTimes(1);
    expect(sourcePage.mock.calls[0][0]).toEqual({ documentVersionId: 'DV-OLD', limit: 12 });
    expect(container.textContent).toContain('source-approved');
    expect(container.textContent).toContain('source-unapproved');
    expect(container.textContent).not.toContain('DRAFT_MARKER_MUST_NOT_RENDER');
    expect(sourceHistory).not.toHaveBeenCalled();
    expect(sourceRecord).not.toHaveBeenCalled();
    expect(sourceRelations).not.toHaveBeenCalled();
    const next = [...container.querySelectorAll('button')].find(button => button.textContent === '下一页意见')!;
    await act(async () => next.click());
    expect(sourcePage.mock.calls[1][0]).toEqual({ documentVersionId: 'DV-OLD', after: 'next-page', limit: 12 });
  });

  it('clears old scope immediately on a business-version/session change and exposes unconfigured source errors', async () => {
    sourcePage.mockResolvedValueOnce({ documentVersionId: 'DV-OLD', sourceStatus: 'AVAILABLE',
      records: [sourceRead('old-private', 'DV-OLD')], hasMore: false, nextAfter: null });
    await mountSource('DV-OLD');
    expect(container.textContent).toContain('Private excerpt old-private');
    sourcePage.mockRejectedValueOnce({ code: 'TDMS_SOURCE_AUTHORIZATION_UNCONFIGURED', statusCode: 503 });
    sessionGeneration = 2;
    await mountSource('DV-NEW');
    expect(container.textContent).not.toContain('Private excerpt old-private');
    expect(container.textContent).toContain('尚未配置 TDMS 来源读取授权');
    expect(container.textContent).not.toContain('暂无已取得的记录');
  });

  it('pins a historical LCM snapshot and reads only its requested row page', async () => {
    lcmCatalogue.mockResolvedValue({ snapshots: [snapshot('newer')], hasMore: false, nextAfter: null });
    lcmRows.mockResolvedValue({ snapshot: snapshot('older'), records: [configurationRecord()], hasMore: false, nextAfter: null });
    await act(async () => root.render(createElement(MemoryRouter, {
      initialEntries: ['/library?mode=lcm&lcmSnapshotId=older&tailNumber=B-TEST&position=FIN-TEST'],
      future: { v7_startTransition: true, v7_relativeSplatPath: true },
    }, createElement(LcmConfigurationLibrary))));
    expect(lcmCatalogue).toHaveBeenCalledTimes(1);
    expect(lcmRows).toHaveBeenCalledTimes(1);
    expect(lcmRows.mock.calls[0][0]).toMatchObject({ snapshotId: 'older', tailNumber: 'B-TEST', position: 'FIN-TEST', limit: 24 });
    expect(container.textContent).toContain('不代表当前实时构型');
    expect(container.textContent).toContain('source-raw-state');
    expect(sourcePage).not.toHaveBeenCalled();
    expect(sourceRecord).not.toHaveBeenCalled();
  });
});
