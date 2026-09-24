import { DocumentReadingListService } from '../../server/modules/canonical-host/document-reading-list.service';

it('does not expose a retracted latest reading through the batch preview', async () => {
  const runs = { getLatestCompleted: jest.fn().mockResolvedValue({
    parseRunId: 'PR-current', semanticRevision: 1, readingRevision: 1, retracted: true,
    savedReading: { headline: '错误候选', brief: { text: '错误摘要' } },
  }) };
  const service = new DocumentReadingListService(runs as never, {} as never);
  const result = await service.getBatchPreview(['DV-current'], 'current', {
    tenantId: 'tenant-test', actorUserId: 'actor-test',
  });
  expect(result).toEqual([{ documentVersionId: 'DV-current', parseRunId: 'PR-current',
    semanticRevision: 1, headline: null, briefSummary: null, status: 'RETRACTED' }]);
});
