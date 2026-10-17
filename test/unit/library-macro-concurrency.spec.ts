import type { EngineeringMatterReadModel } from '@shared/api.interface';
import { getCanonicalLibraryDocuments } from '@client/src/api/canonical-host';
import { getEngineeringMatterDirectory, getEngineeringMatter } from '@client/src/api/engineering-matter';
import { readLibraryMacro, LIBRARY_MACRO_BUDGET } from '@client/src/pages/RelationGraphPage/library-macro-read';
import { libraryDocuments } from './fixtures/canonical-library';
import { libraryMatterFixture } from './fixtures/library-matter';

jest.mock('@client/src/api/canonical-host', () => ({
  getCanonicalLibraryDocuments: jest.fn(), getCanonicalLibraryGraph: jest.fn(),
  summarizeCanonicalDocumentReadFailure: (reason: { statusCode?: number }) => ({ statusCode: reason?.statusCode }),
}));
jest.mock('@client/src/api/engineering-matter', () => ({
  getEngineeringMatterDirectory: jest.fn(), getEngineeringMatter: jest.fn(),
}));

interface PendingMatter {
  resolve(value: EngineeringMatterReadModel): void;
  reject(reason: unknown): void;
}

const docs = jest.mocked(getCanonicalLibraryDocuments);
const directory = jest.mocked(getEngineeringMatterDirectory);
const matterRead = jest.mocked(getEngineeringMatter);
const request = { level: 'clusters', groupBy: 'ata' } as const;
const pending = new Map<string, PendingMatter>();
let active: number;
let peak: number;

function matter(id: string): EngineeringMatterReadModel {
  return { ...libraryMatterFixture().matter, matterId: id };
}

const flush = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

beforeEach(() => {
  jest.resetAllMocks();
  active = 0; peak = 0; pending.clear();
  docs.mockResolvedValue(libraryDocuments(['synthetic-document']));
  directory.mockResolvedValue({ items: Array.from({ length: 8 }, (_, index: number) => ({
    matterId: `matter-${index}`, title: `Synthetic ${index}`, primaryWorkItemId: null,
    createdAt: '', updatedAt: '', currentMatterRevisionId: matter(`matter-${index}`).currentRevision.matterRevisionId,
    workingRevision: 0, result: null,
  })), nextCursor: null, fileReadPerformed: false });
  matterRead.mockImplementation((id: string) => {
    active += 1; peak = Math.max(peak, active);
    return new Promise<EngineeringMatterReadModel>((resolve, reject) => {
      pending.set(id, {
        resolve: (value: EngineeringMatterReadModel): void => { active -= 1; resolve(value); },
        reject: (reason: unknown): void => { active -= 1; reject(reason); },
      });
    });
  });
});

async function settle(id: string, reason?: unknown): Promise<void> {
  const entry = pending.get(id);
  expect(entry).toBeDefined();
  if (reason) entry!.reject(reason); else entry!.resolve(matter(id));
  await flush();
}

it('reuses a free slot immediately while slow earlier reads are pending and preserves directory order', async () => {
  const read = readLibraryMacro(request, new AbortController().signal);
  await flush();
  expect(matterRead.mock.calls.map(([id]) => id)).toEqual(['matter-0', 'matter-1', 'matter-2', 'matter-3']);
  await settle('matter-1');
  expect(pending.has('matter-4')).toBe(true);
  await settle('matter-2');
  expect(pending.has('matter-5')).toBe(true);
  await settle('matter-3');
  expect(pending.has('matter-6')).toBe(true);
  await settle('matter-6');
  expect(pending.has('matter-7')).toBe(true);
  for (const id of ['matter-7', 'matter-5', 'matter-4', 'matter-0']) await settle(id);
  const result = await read;
  expect(result.matters.map((item: EngineeringMatterReadModel) => item.matterId))
    .toEqual(Array.from({ length: 8 }, (_, index: number) => `matter-${index}`));
  expect(peak).toBe(LIBRARY_MACRO_BUDGET.concurrency);
  expect(active).toBe(0);
  expect(result.coverage.matters).toBe('COMPLETE');
});

it('does not schedule later matter reads after a fast authentication rejection', async () => {
  const read = readLibraryMacro(request, new AbortController().signal);
  let rejected: boolean = false;
  const outcome = expect(read.catch((reason: unknown) => {
    rejected = true;
    throw reason;
  })).rejects.toMatchObject({ statusCode: 401 });
  await flush();
  await settle('matter-1', Object.assign(new Error('expired'), { statusCode: 401 }));
  expect(rejected).toBe(true);
  await settle('matter-2');
  await settle('matter-3');
  await settle('matter-0');
  await outcome;
  expect(matterRead).toHaveBeenCalledTimes(4);
});

it('stops new work on cancellation without accepting partially completed results', async () => {
  const controller = new AbortController();
  const read = readLibraryMacro(request, controller.signal);
  const outcome = expect(read).rejects.toMatchObject({ name: 'AbortError' });
  await flush();
  controller.abort();
  for (const id of ['matter-0', 'matter-1', 'matter-2', 'matter-3']) await settle(id);
  await outcome;
  expect(matterRead).toHaveBeenCalledTimes(4);
});

it('continues authorized siblings while reporting access, transport and revision failures separately', async () => {
  const read = readLibraryMacro(request, new AbortController().signal);
  await flush();
  await settle('matter-1', Object.assign(new Error('denied'), { statusCode: 403 }));
  expect(pending.has('matter-4')).toBe(true);
  await settle('matter-2', Object.assign(new Error('unavailable'), { statusCode: 503 }));
  expect(pending.has('matter-5')).toBe(true);
  const changed = matter('matter-4');
  changed.currentRevision.matterRevisionId = 'different-revision';
  pending.get('matter-4')!.resolve(changed);
  await flush();
  for (const id of ['matter-0', 'matter-3', 'matter-5', 'matter-6', 'matter-7']) await settle(id);
  const result = await read;
  expect(result.matters.map((item: EngineeringMatterReadModel) => item.matterId))
    .toEqual(['matter-0', 'matter-3', 'matter-5', 'matter-6', 'matter-7']);
  expect(result.coverage.matters).toBe('PARTIAL');
  expect(result.matterFailures).toEqual({ unreadable: 1, failed: 2 });
  expect(result.documents).toHaveLength(1);
  expect(peak).toBe(4);
});

it('starts the independent matter directory while document catalog data is pending', async () => {
  let resolveDocuments!: (value: Awaited<ReturnType<typeof getCanonicalLibraryDocuments>>) => void;
  docs.mockImplementation(() => new Promise((resolve) => { resolveDocuments = resolve; }));
  directory.mockResolvedValue({ items: [], nextCursor: null, fileReadPerformed: false });
  const read = readLibraryMacro(request, new AbortController().signal);
  await flush();
  expect(directory).toHaveBeenCalledTimes(1);
  expect(matterRead).not.toHaveBeenCalled();
  resolveDocuments(libraryDocuments(['synthetic-document']));
  const result = await read;
  expect(result.documents).toHaveLength(1);
  expect(result.coverage.matters).toBe('COMPLETE');
  expect(directory).toHaveBeenCalledTimes(1);
});

it('handles an early directory rejection while documents are pending without losing their separate read', async () => {
  let resolveDocuments!: (value: Awaited<ReturnType<typeof getCanonicalLibraryDocuments>>) => void;
  docs.mockImplementation(() => new Promise((resolve) => { resolveDocuments = resolve; }));
  directory.mockRejectedValue(Object.assign(new Error('unavailable'), { statusCode: 503 }));
  const read = readLibraryMacro(request, new AbortController().signal);
  await flush();
  expect(directory).toHaveBeenCalledTimes(1);
  resolveDocuments(libraryDocuments(['synthetic-document']));
  const result = await read;
  expect(result.documents).toHaveLength(1);
  expect(result.coverage.matters).toBe('READ_FAILED');
  expect(matterRead).not.toHaveBeenCalled();
});

it('does not start speculative directory reads after prior cancellation', async () => {
  const controller = new AbortController(); controller.abort();
  await expect(readLibraryMacro(request, controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
  expect(docs).not.toHaveBeenCalled();
  expect(directory).not.toHaveBeenCalled();
});
