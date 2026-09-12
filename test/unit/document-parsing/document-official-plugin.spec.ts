import { Logger } from '@nestjs/common';
import { CapabilityService } from '@lark-apaas/fullstack-nestjs-core';
import { Test } from '@nestjs/testing';
import { DocumentOfficialPluginService, DocumentPluginOutputError } from '../../../server/modules/document-management/src/hosted/nest/document-official-plugin.service';

describe('official document adapter (isolated provider doubles)', () => {
  const call = jest.fn();
  const load = jest.fn(() => ({ call }));
  let service: DocumentOfficialPluginService;
  beforeEach(async () => {
    jest.restoreAllMocks();
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.clearAllMocks();
    const module = await Test.createTestingModule({ providers: [DocumentOfficialPluginService,
      { provide: CapabilityService, useValue: { load } }] }).compile();
    service = module.get(DocumentOfficialPluginService);
  });
  it('resolves the Host URL after checking activity, and reports only actual plugin provenance', async () => {
    call.mockResolvedValue({ content: 'Original text.' });
    const assertActive = jest.fn(async () => undefined);
    const result = await service.parseOriginal({ assertActive, originalUrl: async () => 'https://example.invalid/signed-test-only' });
    expect(call).toHaveBeenCalledWith('parseDocToMarkdown', { fileUrl: ['https://example.invalid/signed-test-only'] });
    expect(assertActive).toHaveBeenCalledTimes(3);
    expect(result.producer.concreteModel).toBeNull();
  });
  it('rejects late results after a lease is invalidated', async () => {
    call.mockResolvedValue({ translation: '译文' });
    let checks = 0;
    await expect(service.translateProse('Original.', async () => {
      if (++checks === 2) throw new Error('LEASE_LOST');
    })).rejects.toThrow('LEASE_LOST');
  });
  it('rejects swapped or duplicated structured IDs rather than assigning by position', async () => {
    call.mockResolvedValue({ items: [{ id: 'b', translation: '二' }, { id: 'a', translation: '一' }] });
    await expect(service.translateStructure([{ id: 'a', text: 'One' }, { id: 'b', text: 'Two' }], async () => undefined))
      .rejects.toThrow('DOCUMENT_TRANSLATION_ID_MISMATCH');
  });
  it('does not call a plugin for an already invalid task', async () => {
    await expect(service.translateProse('Original.', async () => { throw new Error('CANCELLED'); })).rejects.toThrow('CANCELLED');
    expect(call).not.toHaveBeenCalled();
  });
  it('classifies a received invalid output without exposing raw provider content', async () => {
    call.mockResolvedValue({ translation: '   ', unexpected: 'PRIVATE_PROVIDER_TEXT' });
    await expect(service.translateProse('Original.', async () => undefined))
      .rejects.toThrow('DOCUMENT_TRANSLATION_OUTPUT_INVALID');
    await expect(service.translateProse('Original.', async () => undefined)).rejects.toBeInstanceOf(DocumentPluginOutputError);
  });
  it('does not relabel an upstream timeout as a received invalid output', async () => {
    const unknown = new Error('UPSTREAM_TIMEOUT'); call.mockRejectedValue(unknown);
    await expect(service.translateProse('Original.', async () => undefined)).rejects.toBe(unknown);
  });

  it('records one timed call without its sensitive input or returned body', async () => {
    call.mockResolvedValue({ translation: 'PRIVATE_TRANSLATED_BODY' });
    await service.translateProse('PRIVATE_ORIGINAL_BODY', async () => undefined);
    const entries = (Logger.prototype.log as jest.Mock).mock.calls.map(([entry]) => entry).filter(entry => entry?.event?.startsWith('DOCUMENT_PLUGIN_CALL_'));
    expect(entries.map(entry => entry.event)).toEqual(['DOCUMENT_PLUGIN_CALL_STARTED', 'DOCUMENT_PLUGIN_CALL_RETURNED']);
    expect(entries[0].invocationId).toBe(entries[1].invocationId);
    expect(entries[1].elapsedMs).toBeGreaterThanOrEqual(0);
    expect(entries[1].processLifetimeMaxRssKiB).toBeGreaterThan(0);
    expect(JSON.stringify(entries)).not.toContain('PRIVATE_');
  });
  it('records call failure without claiming a model result or leaking its error details', async () => {
    call.mockRejectedValue(new Error('PRIVATE_PROVIDER_DETAIL'));
    await expect(service.translateProse('PRIVATE_INPUT', async () => undefined)).rejects.toThrow('PRIVATE_PROVIDER_DETAIL');
    const entries = (Logger.prototype.warn as jest.Mock).mock.calls.map(([entry]) => entry).filter(entry => entry?.event?.startsWith('DOCUMENT_PLUGIN_CALL_'));
    expect(entries[0].event).toBe('DOCUMENT_PLUGIN_CALL_ERROR');
    expect(JSON.stringify(entries)).not.toContain('PRIVATE_');
  });

});
