import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import type {
  TdmsAttachmentAcquisitionFact,
  TdmsFileServiceRecordReadResponse,
} from '../../../shared/tdms-file-service-import.interface';
import type { TdmsUnreadAttachment } from '../../../shared/tdms-source.interface';
import { TdmsRecordDetails } from '@client/src/features/tdms-source/TdmsRecordDetails';
import { record } from './reader-fixtures';

const { JSDOM } = require('jsdom');

// Constructed transport and DOM evidence only. These tests never contact TDMS,
// check live source permissions, or read bytes from a real Host object store.
const sourceX = '2026-10-01T09:00:00.000Z';
const hostY = '2026-10-05T11:00:00.000Z';

function unread(id: string, version: string, readStatus: 'NOT_READ' | 'FAILED'): TdmsUnreadAttachment {
  return {
    sourceAttachmentId: id, sourceAttachmentVersion: version,
    fileName: `${id}-${version}.eb`, mediaType: 'application/octet-stream',
    byteLength: 123, readStatus, gap: `source-${readStatus}-gap`,
    selector: `source-selector-${id}-${version}`,
  };
}

function acquisition(overrides: Partial<TdmsAttachmentAcquisitionFact> = {}): TdmsAttachmentAcquisitionFact {
  return {
    memberId: 'member-A-v1', sourceAttachmentId: 'attachment-A',
    sourceAttachmentVersion: 'v1', acquisitionId: 'host-acquisition-A-v1',
    sourceObservedAtDeclared: sourceX, sourceReadStatusAtObservation: 'NOT_READ',
    sourceObservationRevisionRef: null, hostBytesVerifiedAt: hostY,
    currentSourcePermissionChecked: true, semanticReadPerformed: false,
    engineeringExecutionVerified: false, ...overrides,
  };
}

function render(read: TdmsFileServiceRecordReadResponse): { html: string; body: HTMLElement } {
  const html = renderToStaticMarkup(createElement(MemoryRouter, null,
    createElement(TdmsRecordDetails, { read })));
  const body = new JSDOM(`<body>${html}</body>`).window.document.body;
  return { html, body };
}

function card(body: HTMLElement, memberId: string): string {
  const cards = Array.from(body.querySelectorAll('.tdms-source-artifact'));
  const match = cards.find(node => node.textContent?.includes(memberId));
  expect(match).toBeDefined();
  return match?.textContent ?? '';
}

function sourceCard(body: HTMLElement, selector: string): string {
  const cards = Array.from(body.querySelectorAll('.tdms-source-artifact'));
  const match = cards.find(node => node.textContent?.includes(selector));
  expect(match).toBeDefined();
  return match?.textContent ?? '';
}

describe('TDMS exact-record attachment fact layers in the real renderer', () => {
  it('preserves source NOT_READ at X beside later verified Host bytes at Y without a merged read state', () => {
    const read: TdmsFileServiceRecordReadResponse = {
      ...record('observation-A'),
      record: {
        ...record('observation-A').record, observedAt: sourceX,
        unreadAttachments: [unread('attachment-A', 'v1', 'NOT_READ')],
      },
      attachmentAcquisitions: [acquisition()],
    };
    const original = JSON.stringify(read);
    const { body } = render(read);
    const text = body.textContent ?? '';
    const hostCard = card(body, 'member-A-v1');
    const originalSourceCard = sourceCard(body, 'source-selector-attachment-A-v1');

    expect(read.record.unreadAttachments[0].readStatus).toBe('NOT_READ');
    expect(originalSourceCard).toContain('source-NOT_READ-gap');
    expect(originalSourceCard).toContain(sourceX);
    expect(hostCard).toContain('host-acquisition-A-v1');
    expect(hostCard).toContain(sourceX);
    expect(hostCard).toContain(hostY);
    expect(hostCard).toMatch(/NOT_READ|未取得附件字节/u);
    expect(hostCard).toMatch(/Host[^。；]*字节|字节[^。；]*Host/u);
    expect(text).toMatch(/正文未读|语义未读|未做语义读取|未做语义阅读/u);
    expect(text).toMatch(/未核验实际执行|工程执行未核验|未验证工程执行|未做语义阅读或执行验证/u);
    expect(hostCard).not.toMatch(/已读附件正文|附件正文已读|已解析附件|已执行工程/u);
    expect(JSON.stringify(read)).toBe(original);
  });

  it('keeps a FAILED source observation distinct from a later acquisition', () => {
    const read: TdmsFileServiceRecordReadResponse = {
      ...record('observation-B'),
      record: {
        ...record('observation-B').record, observedAt: sourceX,
        unreadAttachments: [unread('attachment-B', 'v2', 'FAILED')],
      },
      attachmentAcquisitions: [acquisition({
        memberId: 'member-B-v2', sourceAttachmentId: 'attachment-B',
        sourceAttachmentVersion: 'v2', acquisitionId: 'host-acquisition-B-v2',
        sourceReadStatusAtObservation: 'FAILED',
      })],
    };
    const { body } = render(read);
    const text = body.textContent ?? '';
    const hostCard = card(body, 'member-B-v2');
    const originalSourceCard = sourceCard(body, 'source-selector-attachment-B-v2');
    expect(originalSourceCard).toContain('source-FAILED-gap');
    expect(originalSourceCard).toContain(sourceX);
    expect(hostCard).toMatch(/FAILED|读取失败/u);
    expect(hostCard).toContain(sourceX);
    expect(hostCard).toContain(hostY);
    expect(text).not.toMatch(/源附件.*已成功读取|已成功解析附件/u);
  });

  it('does not invent NOT_READ when acquisition source status is null', () => {
    const read: TdmsFileServiceRecordReadResponse = {
      ...record('observation-null'),
      attachmentAcquisitions: [acquisition({
        memberId: 'member-null', sourceAttachmentId: 'attachment-null',
        sourceAttachmentVersion: null, acquisitionId: 'host-acquisition-null',
        sourceReadStatusAtObservation: null,
      })],
    };
    const { body } = render(read);
    const hostCard = card(body, 'member-null');
    expect(hostCard).toContain('host-acquisition-null');
    expect(hostCard).toMatch(/未取得|未声明|未知/u);
    expect(hostCard).not.toMatch(/NOT_READ|FAILED|附件尚未读取|附件读取失败/u);
  });

  it('keeps member and source version identities separate across multiple acquisitions', () => {
    const read: TdmsFileServiceRecordReadResponse = {
      ...record('observation-multi'),
      attachmentAcquisitions: [
        acquisition(),
        acquisition({ memberId: 'member-A-v2', sourceAttachmentVersion: 'v2',
          acquisitionId: 'host-acquisition-A-v2', sourceReadStatusAtObservation: 'FAILED',
          sourceObservationRevisionRef: 'source-observation-v2',
          sourceObservedAtDeclared: '2026-10-03T09:00:00.000Z',
          hostBytesVerifiedAt: '2026-10-05T12:00:00.000Z' }),
      ],
    };
    const { body } = render(read);
    const v1 = card(body, 'member-A-v1');
    const v2 = card(body, 'member-A-v2');
    expect(v1).toContain('v1');
    expect(v1).toContain('host-acquisition-A-v1');
    expect(v1).toContain(sourceX);
    expect(v1).toContain(hostY);
    expect(v1).not.toContain('source-observation-v2');
    expect(v2).toContain('v2');
    expect(v2).toContain('host-acquisition-A-v2');
    expect(v2).toContain('source-observation-v2');
    expect(v2).toContain('2026-10-03T09:00:00.000Z');
    expect(v2).toContain('2026-10-05T12:00:00.000Z');
    expect(v2).not.toContain('host-acquisition-A-v1');
  });

  it('retains old-response fallback while anchoring source unread metadata to its observation time', () => {
    const old = record('old-shape');
    old.record.observedAt = sourceX;
    old.record.unreadAttachments = [unread('old-attachment', 'v1', 'NOT_READ')];
    const { body } = render(old);
    const text = body.textContent ?? '';
    expect(text).toContain('未读附件清单');
    const originalSourceCard = sourceCard(body, 'source-selector-old-attachment-v1');
    expect(originalSourceCard).toContain('source-NOT_READ-gap');
    expect(originalSourceCard).toContain(sourceX);
    expect(text).not.toContain('host-acquisition-A-v1');
  });

  it('offers no candidate-original open or download route without one in this slice', () => {
    const read: TdmsFileServiceRecordReadResponse = {
      ...record('no-route'),
      record: {
        ...record('no-route').record,
        artifacts: [{
          memberId: 'member-A-v1', sourceArtifactId: 'source-attachment-A',
          acquisitionId: 'host-acquisition-A-v1', fileName: 'original.eb',
          mediaType: 'application/octet-stream', sha256: 'a'.repeat(64),
          byteLength: 123, immutableReadbackVerified: true,
          documentVersionId: null, registrationGap: 'not a formal document version',
        }],
      },
      attachmentAcquisitions: [acquisition()],
    };
    const { body, html } = render(read);
    expect(body.querySelectorAll('a, button')).toHaveLength(0);
    expect(html).not.toMatch(/打开候选|阅读候选|下载候选|candidate-original|candidate\/original/u);
  });
});
