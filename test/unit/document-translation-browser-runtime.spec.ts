import { DocumentTranslationRuntimeService } from '../../server/modules/canonical-host/document-translation-runtime.service';
import { browserTranslationFixture } from './fixtures/document-translation-browser.fixture';
function setup() {
  const f = browserTranslationFixture();
  const scope = { tenantId: f.actor.tenantId, actorUserId: f.actor.actorUserId, documentVersionId: f.documentVersionId };
  const authorization = { authorizeDocumentWork: jest.fn().mockResolvedValue(scope) };
  const actors = { withActorScope: jest.fn(async (_actor, operation) => operation()) };
  const reader = { readDocumentOriginal: jest.fn().mockResolvedValue(f.original) };
  const parsing = { status: jest.fn().mockResolvedValue({}) };
  const attempts = { readAttempt: jest.fn().mockResolvedValue(f.row), resumeSavedKnownFailure: jest.fn() };
  const runtime = new DocumentTranslationRuntimeService(authorization as never, actors as never, reader as never,
    {} as never, attempts as never, {} as never, parsing as never, {} as never, {} as never);
  const input = { action: 'RESUME_KNOWN_FAILURE' as const, documentVersionId: f.documentVersionId,
    parseRunId: f.parseRunId, attemptRef: f.row.operationRef!, deliveryRef: `acquisition:${f.acquisitionId}` };
  return { ...f, scope, authorization, actors, reader, parsing, attempts, runtime, input };
}
it.each(['tenantId', 'actorUserId'])('rejects fresh service %s substitution before entering actor scope', async field => {
  const f = setup(); f.authorization.authorizeDocumentWork.mockResolvedValue({ ...f.scope, [field]: 'other' });
  await expect(f.runtime.continueForBrowser(f.input, f.scope, async () => {})).rejects.toThrow('BROWSER_SCOPE_MISMATCH');
  expect(f.actors.withActorScope).not.toHaveBeenCalled();
});
it('rechecks browser authority inside the runtime before reading source or reserving a successor', async () => {
  const f = setup(); const check = jest.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('ACL_REVOKED'));
  await expect(f.runtime.continueForBrowser(f.input, f.scope, check)).rejects.toThrow('ACL_REVOKED');
  expect(check).toHaveBeenCalledTimes(2);
  expect(f.reader.readDocumentOriginal).not.toHaveBeenCalled();
  expect(f.attempts.resumeSavedKnownFailure).not.toHaveBeenCalled();
});
