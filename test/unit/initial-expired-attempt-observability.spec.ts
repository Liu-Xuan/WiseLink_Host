import type { CanonicalInitialAttemptProtectionReason, CanonicalInitialAttemptRead } from '../../shared/api.interface';
import { sealTaskEnvelope } from '../../server/modules/action-attempt/action-attempt-envelope';
import { InitialExpiredAttemptRepository, initialAttemptLeaseProtection } from
  '../../server/modules/action-attempt/initial-expired-attempt.repository';

type LeaseInputs = Parameters<typeof initialAttemptLeaseProtection>;
type GrantFacts = NonNullable<LeaseInputs[3]>;
const now: Date = new Date('2026-10-28T04:15:10.505Z');
const due: Date = new Date(now.getTime() - 1);
const future: Date = new Date(now.getTime() + 1);
const lease: LeaseInputs[0] = {leaseExpiresAt: due, leaseToken: 'synthetic-secret-token', leaseOwner: 'synthetic-executor'};
const owner: LeaseInputs[1] = {requestId: 'intake-synthetic', requestedByUserId: 'owner-synthetic',
  documentId: 'DOC-synthetic', documentVersionId: 'DV-synthetic', sourceArtifactId: 'source-synthetic',
  sourceFileSha256: 'a'.repeat(64), sourceByteLength: 10};
const bound: NonNullable<LeaseInputs[2]> = {requestId: owner.requestId, leaseGeneration: 17};
const grant: GrantFacts = {status: 'LEASED', grantKind: 'MIAODA_CANONICAL_PARSE_REQUEST', requestId: owner.requestId,
  leaseGeneration: 17, leaseOwner: lease.leaseOwner, actorUserId: owner.requestedByUserId,
  documentId: owner.documentId, documentVersionId: owner.documentVersionId, sourceArtifactId: owner.sourceArtifactId,
  sourceFileSha256: owner.sourceFileSha256, sourceByteLength: owner.sourceByteLength, leaseExpiresAt: due,
  completedAt: null, blockedAt: null};

// Frozen ff108440 predicate: the new diagnostics must leave every comparison and bypass equivalent.
function originalGrantMatches(row: LeaseInputs[0], primary: LeaseInputs[1], sealed: LeaseInputs[2], current: LeaseInputs[3]) {
  return !sealed || !!current && current.status === 'LEASED' && current.grantKind === 'MIAODA_CANONICAL_PARSE_REQUEST' &&
    current.requestId === sealed.requestId && current.requestId === primary.requestId && current.leaseGeneration === sealed.leaseGeneration &&
    current.leaseOwner === row.leaseOwner && current.actorUserId === primary.requestedByUserId &&
    current.documentId === primary.documentId && current.documentVersionId === primary.documentVersionId &&
    current.sourceArtifactId === primary.sourceArtifactId && current.sourceFileSha256 === primary.sourceFileSha256 &&
    Number(current.sourceByteLength) === Number(primary.sourceByteLength) && !!current.leaseExpiresAt && current.leaseExpiresAt <= now &&
    !current.completedAt && !current.blockedAt;
}

interface GrantCase {name: string; change: Partial<GrantFacts>; reasons: CanonicalInitialAttemptProtectionReason[]}
const grantCases: GrantCase[] = [
  {name: 'status', change: {status: 'WAITING'}, reasons: ['GRANT_STATUS_CHANGED']},
  {name: 'kind', change: {grantKind: 'synthetic-other-kind'}, reasons: ['GRANT_KIND_CHANGED']},
  {name: 'request', change: {requestId: 'synthetic-other-request'}, reasons: ['GRANT_SEALED_REQUEST_CHANGED', 'GRANT_INTAKE_REQUEST_CHANGED']},
  {name: 'generation', change: {leaseGeneration: 18}, reasons: ['GRANT_GENERATION_CHANGED']},
  {name: 'missing owner', change: {leaseOwner: null}, reasons: ['GRANT_LEASE_OWNER_MISSING']},
  {name: 'empty owner', change: {leaseOwner: ''}, reasons: ['GRANT_LEASE_OWNER_MISSING']},
  {name: 'owner', change: {leaseOwner: 'synthetic-private-other-executor'}, reasons: ['GRANT_LEASE_OWNER_CHANGED']},
  {name: 'actor', change: {actorUserId: 'synthetic-private-other-actor'}, reasons: ['GRANT_ACTOR_CHANGED']},
  {name: 'document', change: {documentId: 'synthetic-private-document'}, reasons: ['GRANT_DOCUMENT_CHANGED']},
  {name: 'version', change: {documentVersionId: 'synthetic-private-version'}, reasons: ['GRANT_DOCUMENT_VERSION_CHANGED']},
  {name: 'artifact', change: {sourceArtifactId: 'synthetic-private-artifact'}, reasons: ['GRANT_SOURCE_ARTIFACT_CHANGED']},
  {name: 'hash', change: {sourceFileSha256: 'b'.repeat(64)}, reasons: ['GRANT_SOURCE_HASH_CHANGED']},
  {name: 'bytes', change: {sourceByteLength: 11}, reasons: ['GRANT_SOURCE_SIZE_CHANGED']},
  {name: 'missing expiry', change: {leaseExpiresAt: null}, reasons: ['GRANT_LEASE_EXPIRY_MISSING']},
  {name: 'future expiry', change: {leaseExpiresAt: future}, reasons: ['GRANT_LEASE_ACTIVE']},
  {name: 'completed', change: {completedAt: due}, reasons: ['GRANT_COMPLETED']},
  {name: 'blocked', change: {blockedAt: due}, reasons: ['GRANT_BLOCKED']},
];

it.each(grantCases)('classifies the actual original grant $name predicate without exposing compared values', ({change, reasons}: GrantCase) => {
  const current: GrantFacts = {...grant, ...change};
  const details: ReturnType<typeof initialAttemptLeaseProtection> = initialAttemptLeaseProtection(lease, owner, bound, current, now);
  expect(details.automatic?.reasons).toEqual(reasons);
  expect(!details.automatic?.reasons.length).toBe(originalGrantMatches(lease, owner, bound, current));
  expect(Object.keys(details.automatic!).sort()).toEqual(['currentGrantLeaseGeneration', 'grantLeaseExpiresAt',
    'grantStatus', 'reasons', 'sealedGrantLeaseGeneration']);
  const serialized: string = JSON.stringify(details);
  const compared: Array<string | null> = [lease.leaseToken, lease.leaseOwner, owner.requestId, owner.requestedByUserId,
    current.leaseOwner, current.actorUserId, current.documentId, current.documentVersionId,
    current.sourceArtifactId, current.sourceFileSha256];
  for (const secret of compared.filter((value: string | null): value is string => typeof value === 'string' && value.length > 0))
    expect(serialized).not.toContain(secret);
});

it('keeps all original attempt lease null/empty/future predicates equivalent, including equality at Host time', () => {
  for (const expires of [null, due, now, future]) for (const token of [null, '', lease.leaseToken])
    for (const principal of [null, '', lease.leaseOwner]) {
      const row: LeaseInputs[0] = {leaseExpiresAt: expires, leaseToken: token, leaseOwner: principal};
      const detail: ReturnType<typeof initialAttemptLeaseProtection> = initialAttemptLeaseProtection(row, owner, bound, grant, now);
      const protectedBefore: boolean = !row.leaseExpiresAt || row.leaseExpiresAt > now || !row.leaseToken || !row.leaseOwner;
      expect(detail.attempt.reasons.length > 0).toBe(protectedBefore);
      expect(detail.attempt.reasons.includes('ATTEMPT_LEASE_ACTIVE')).toBe(expires === future);
      expect(detail.attempt.reasons.includes('ATTEMPT_LEASE_EXPIRY_MISSING')).toBe(expires === null);
      expect(detail.attempt.reasons.includes('ATTEMPT_LEASE_TOKEN_MISSING')).toBe(!token);
      expect(detail.attempt.reasons.includes('ATTEMPT_LEASE_OWNER_MISSING')).toBe(!principal);
      expect(!detail.automatic?.reasons.length).toBe(originalGrantMatches(row, owner, bound, grant));
    }
});

it('preserves absent automatic binding, unavailable grant, independent intake bindings and grant equality at Host time', () => {
  expect(initialAttemptLeaseProtection(lease, owner, undefined, null, now).automatic).toBeNull();
  expect(initialAttemptLeaseProtection(lease, owner, bound, null, now).automatic).toEqual({
    reasons: ['GRANT_UNAVAILABLE'], grantLeaseExpiresAt: null, sealedGrantLeaseGeneration: 17,
    currentGrantLeaseGeneration: null, grantStatus: null});
  const atBoundary: GrantFacts = {...grant, leaseExpiresAt: now};
  expect(initialAttemptLeaseProtection(lease, owner, bound, atBoundary, now).automatic?.reasons).toEqual([]);
  expect(originalGrantMatches(lease, owner, bound, atBoundary)).toBe(true);
  expect(initialAttemptLeaseProtection(lease, owner, {...bound, requestId: 'sealed-other'}, grant, now)
    .automatic?.reasons).toEqual(['GRANT_SEALED_REQUEST_CHANGED']);
  expect(initialAttemptLeaseProtection(lease, {...owner, requestId: 'intake-other'}, bound, grant, now)
    .automatic?.reasons).toEqual(['GRANT_INTAKE_REQUEST_CHANGED']);
  const zeroOwner: LeaseInputs[1] = {...owner, sourceByteLength: 0};
  const zeroGrant: GrantFacts = {...grant, sourceByteLength: 0};
  expect(!initialAttemptLeaseProtection(lease, zeroOwner, bound, zeroGrant, now).automatic?.reasons.length)
    .toBe(originalGrantMatches(lease, zeroOwner, bound, zeroGrant));
});

type ReadRow = LeaseInputs[0] & {attemptId: string; operationRef: string; workItemId: string; tenantId: string;
  documentVersionId: string; actorUserId: string; idempotencyKey: string; taskInputHash: string; taskEnvelopeJson: string;
  actionType: string; inputRevision: number; baseRevision: number; leaseGeneration: number; status: string;
  deadlineAt: Date; commitStartedAt: Date | null; completedAt: Date | null; cancelRequestedAt: Date | null;
  cancelReason: string | null; terminalReason: string | null; hasPersistedResult: boolean; projectionApplied: boolean;
  reviewActivityJson: string; attemptNo: number};
interface Coverage {covered: boolean; saved: CanonicalInitialAttemptRead['savedWorks']; otherActive: boolean}

function readHarness(patch: Partial<ReadRow> = {}, currentGrant: GrantFacts | null = grant,
  proof: Coverage = {covered: true, saved: [], otherActive: false}) {
  const row: ReadRow = {...lease, attemptId: 'ATT-synthetic', operationRef: 'AQ-synthetic', workItemId: 'WI-synthetic',
    tenantId: 'tenant-synthetic', documentVersionId: owner.documentVersionId, actorUserId: owner.requestedByUserId,
    idempotencyKey: 'openclaw-v2:dynamic:WI-synthetic:DV-synthetic:stage-synthetic', taskInputHash: '', taskEnvelopeJson: '',
    actionType: 'OPENCLAW_DYNAMIC_EVALUATION', inputRevision: 3, baseRevision: 3, leaseGeneration: 1,
    status: 'RUNNING', deadlineAt: due, commitStartedAt: null, completedAt: null, cancelRequestedAt: null,
    cancelReason: null, terminalReason: null, hasPersistedResult: false, projectionApplied: false,
    reviewActivityJson: '[]', attemptNo: 1, ...patch};
  const task: ReturnType<typeof sealTaskEnvelope> = sealTaskEnvelope({
    schemaVersion: 'wiselink.3_1.openclaw_task_envelope.v1', actionAttemptId: row.attemptId, operationRef: row.operationRef,
    taskType: 'OPENCLAW_DYNAMIC_EVALUATION', priority: 10, tenantId: row.tenantId, workItemId: row.workItemId,
    inputRevision: row.inputRevision, baseRevision: row.baseRevision, documentVersionId: row.documentVersionId,
    sourceRefs: [], allowedConnectors: [], hostResolvedMissingInputs: [], deadline: row.deadlineAt.toISOString(),
    idempotencyKey: row.idempotencyKey, modelInput: {schemaVersion: 'wiselink.jobaid-problem-task.v2',
      actorUserId: owner.requestedByUserId, modelInput: {purpose: 'INITIAL_PROBLEM_ASSESSMENT'}, automaticWorkItemLease: bound,
      sourceBindings: [{workItemId: row.workItemId, documentVersionId: row.documentVersionId,
        artifactRef: 'artifact://synthetic', artifactSha256: owner.sourceFileSha256}]} });
  row.taskInputHash = task.inputHash;
  row.taskEnvelopeJson = JSON.stringify(task);
  const primary = {...owner, workItemId: row.workItemId, tenantId: row.tenantId, revision: 3,
    projectionJson: JSON.stringify({package: {artifact: {ref: 'artifact://synthetic', sha256: owner.sourceFileSha256}}})};
  const rows: unknown[][] = [[row], [primary], currentGrant ? [currentGrant] : []];
  const query = {from: jest.fn(), where: jest.fn(), limit: jest.fn(async () => rows.shift() ?? [])};
  query.from.mockReturnValue(query); query.where.mockReturnValue(query);
  const database = {select: jest.fn(() => query), execute: jest.fn().mockResolvedValue([proof]),
    update: jest.fn(), insert: jest.fn(), delete: jest.fn(), transaction: jest.fn()};
  const authorize = jest.fn().mockResolvedValue(undefined);
  const repository: InitialExpiredAttemptRepository = new InitialExpiredAttemptRepository(database as never);
  const read = () => repository.read({tenantId: row.tenantId, actorUserId: owner.requestedByUserId, workItemId: row.workItemId},
    {attemptId: row.attemptId, attemptRef: row.operationRef}, authorize);
  return {read, rows, row, primary, proof, currentGrant, database, authorize};
}

beforeEach(() => {jest.useFakeTimers(); jest.setSystemTime(now);});
afterEach(() => {jest.useRealTimers();});

it('keeps the actual repository GET write-free and projects only safe diagnostics after both original authorizations', async () => {
  const h = readHarness({}, {...grant, leaseGeneration: 18, leaseOwner: 'synthetic-private-other-executor'});
  const before: string = JSON.stringify([h.row, h.primary, h.proof, h.currentGrant]);
  const result: CanonicalInitialAttemptRead = await h.read();
  expect(result.protectionCode).toBe('GRANT_CHANGED_OR_ACTIVE');
  expect(result.protectionDetails?.reasons).toEqual(['GRANT_GENERATION_CHANGED', 'GRANT_LEASE_OWNER_CHANGED']);
  expect(result.leaseGeneration).toBe(1);
  expect(result.protectionDetails?.sealedGrantLeaseGeneration).toBe(17);
  expect(result.protectionDetails?.currentGrantLeaseGeneration).toBe(18);
  expect(h.authorize).toHaveBeenCalledTimes(2);
  expect(h.rows).toHaveLength(0);
  expect(h.database.select).toHaveBeenCalledTimes(3);
  expect(h.database.execute).toHaveBeenCalledTimes(1);
  for (const write of [h.database.insert, h.database.update, h.database.delete, h.database.transaction])
    expect(write).not.toHaveBeenCalled();
  expect(JSON.stringify([h.row, h.primary, h.proof, h.currentGrant])).toBe(before);
  const serialized: string = JSON.stringify(result);
  for (const secret of [lease.leaseToken!, lease.leaseOwner!, 'synthetic-private-other-executor',
    'taskEnvelopeJson', 'modelInput', 'resultEnvelopeJson', 'sourceFileSha256'])
    expect(serialized).not.toContain(secret);
});

interface PriorityCase {name: string; patch: Partial<ReadRow>; code: string | null; current?: GrantFacts | null; otherActive?: boolean}
const priorityCases: PriorityCase[] = [
  {name: 'saved before unknown activity', patch: {hasPersistedResult: true, reviewActivityJson: '[{"kind":"UNKNOWN"}]'}, code: 'SAVED_OR_COMMITTING'},
  {name: 'activity before status', patch: {reviewActivityJson: '[{"kind":"UNKNOWN"}]', status: 'QUEUED'}, code: 'ACTIVITY_UNKNOWN'},
  {name: 'status before deadline', patch: {status: 'QUEUED', deadlineAt: future}, code: 'NOT_RUNNING'},
  {name: 'deadline before lease', patch: {deadlineAt: future, leaseExpiresAt: null}, code: 'DEADLINE_NOT_EXPIRED'},
  {name: 'deadline equality and active lease', patch: {deadlineAt: now, leaseExpiresAt: future}, code: 'LEASE_NOT_EXPIRED'},
  {name: 'lease before completed state', patch: {leaseExpiresAt: null, completedAt: due}, code: 'LEASE_NOT_EXPIRED'},
  {name: 'state before revision', patch: {completedAt: due, baseRevision: 2}, code: 'STATE_UNKNOWN'},
  {name: 'revision before grant', patch: {inputRevision: 2}, current: null, code: 'WORK_ITEM_CHANGED'},
  {name: 'grant before successor', patch: {}, current: null, otherActive: true, code: 'GRANT_CHANGED_OR_ACTIVE'},
  {name: 'successor', patch: {}, otherActive: true, code: 'SUCCESSOR_PRESENT'},
  {name: 'equal deadline and lease expiry remain eligible', patch: {deadlineAt: now, leaseExpiresAt: now},
    current: {...grant, leaseExpiresAt: now}, code: null},
];
it.each(priorityCases)('preserves ff108440 protection priority: $name', async ({patch, code, current, otherActive}: PriorityCase) => {
  const h = readHarness(patch, current === undefined ? grant : current, {covered: true, saved: [], otherActive: !!otherActive});
  const result: CanonicalInitialAttemptRead = await h.read();
  expect(result.protectionCode).toBe(code);
  expect(result.reconciliation).toBe(code ? 'PROTECTED' : 'ELIGIBLE');
  expect(Boolean(result.protectionDetails)).toBe(code === 'LEASE_NOT_EXPIRED' || code === 'GRANT_CHANGED_OR_ACTIVE');
});

it('keeps original timeout replay separate from current lease diagnostics', async () => {
  const result: CanonicalInitialAttemptRead = await readHarness({status: 'TIMED_OUT', completedAt: now,
    terminalReason: 'ACTION_ATTEMPT_DEADLINE_EXCEEDED', leaseExpiresAt: null, leaseToken: null, leaseOwner: null}, null).read();
  expect(result.reconciliation).toBe('ALREADY_TIMED_OUT');
  expect(result.protectionCode).toBeNull(); expect(result.protectionDetails).toBeUndefined();
});

it('returns no diagnostics after original target, authorization or coverage denial', async () => {
  const target = readHarness(); target.rows[0] = [];
  await expect(target.read()).rejects.toThrow('CANONICAL_WORK_ITEM_NOT_FOUND');
  expect(target.authorize).not.toHaveBeenCalled(); expect(target.database.execute).not.toHaveBeenCalled();
  const ownerDenied = readHarness(); ownerDenied.authorize.mockRejectedValueOnce(new Error('ORIGINAL_OWNER_DENIED'));
  await expect(ownerDenied.read()).rejects.toThrow('ORIGINAL_OWNER_DENIED');
  expect(ownerDenied.database.execute).not.toHaveBeenCalled();
  const freshDenied = readHarness(); freshDenied.authorize.mockResolvedValueOnce(undefined)
    .mockRejectedValueOnce(new Error('ORIGINAL_FRESH_PERMISSION_DENIED'));
  await expect(freshDenied.read()).rejects.toThrow('ORIGINAL_FRESH_PERMISSION_DENIED');
  await expect(readHarness({}, grant, {covered: false, saved: [], otherActive: false}).read())
    .rejects.toThrow('INITIAL_EXPIRED_SAVE_COVERAGE_UNKNOWN');
});
