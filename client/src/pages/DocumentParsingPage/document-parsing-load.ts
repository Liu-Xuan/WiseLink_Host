import type { CanonicalDocumentParsingPageResponse } from '@shared/api.interface';

export interface CanonicalDocumentParsingIdentity {
  userId: string;
  tenantId: string;
}

export interface CanonicalDocumentParsingLoadCallbacks {
  isCurrent(): boolean;
  readIdentity(): Promise<CanonicalDocumentParsingIdentity>;
  readPage(
    identity: CanonicalDocumentParsingIdentity,
  ): Promise<CanonicalDocumentParsingPageResponse>;
  onFresh(
    identity: CanonicalDocumentParsingIdentity,
    page: CanonicalDocumentParsingPageResponse,
  ): void;
  onDenied(identity: CanonicalDocumentParsingIdentity, cause: unknown): void;
  onIdentityError(cause: unknown): void;
  onSettled(): void;
}

export interface CanonicalDocumentParsingProjectionRequest {
  identity: CanonicalDocumentParsingIdentity;
  sessionGeneration: number;
  workItemId: string;
  query: string;
}

export interface CanonicalDocumentParsingProjectionReader {
  read(
    request: CanonicalDocumentParsingProjectionRequest,
    readProjection: () => Promise<CanonicalDocumentParsingPageResponse>,
  ): Promise<CanonicalDocumentParsingPageResponse>;
}

const ROUTE_HANDOFF_MAX_AGE_MS = 5_000;

export interface CanonicalDocumentParsingRouteHandoff {
  version: 1;
  createdAtMs: number;
  sessionGeneration: number;
  workItemId: string;
  query: string;
  page: CanonicalDocumentParsingPageResponse;
}

export function createCanonicalDocumentParsingRouteHandoff(
  page: CanonicalDocumentParsingPageResponse,
  sessionGeneration: number,
  query = '',
  createdAtMs = Date.now(),
): CanonicalDocumentParsingRouteHandoff {
  return {
    version: 1,
    createdAtMs,
    sessionGeneration,
    workItemId: page.workItem.workItemId,
    query: query.trim(),
    page,
  };
}

export function resolveCanonicalDocumentParsingRouteHandoff(
  value: unknown,
  expected: {
    sessionGeneration: number;
    workItemId: string;
    query: string;
    nowMs?: number;
  },
): CanonicalDocumentParsingPageResponse | null {
  if (!value || typeof value !== 'object') return null;
  const handoff = value as Partial<CanonicalDocumentParsingRouteHandoff>;
  const nowMs = expected.nowMs ?? Date.now();
  const normalizedQuery = expected.query.trim();
  if (
    handoff.version !== 1 ||
    !Number.isFinite(handoff.createdAtMs) ||
    handoff.createdAtMs! > nowMs ||
    nowMs - handoff.createdAtMs! > ROUTE_HANDOFF_MAX_AGE_MS ||
    handoff.sessionGeneration !== expected.sessionGeneration ||
    handoff.workItemId !== expected.workItemId ||
    handoff.query !== normalizedQuery ||
    handoff.page?.status !== 'FRESH_READ' ||
    handoff.page.workItem.workItemId !== expected.workItemId ||
    (handoff.page.readerProjection?.query ?? '') !== normalizedQuery
  ) {
    return null;
  }
  return handoff.page;
}

/**
 * Shares only identical in-flight projection reads. Resolved responses are never
 * retained, so a later refresh still performs the canonical Host fresh read.
 */
export function createCanonicalDocumentParsingProjectionReader(): CanonicalDocumentParsingProjectionReader {
  const inFlight = new Map<
    string,
    Promise<CanonicalDocumentParsingPageResponse>
  >();

  return {
    read(request, readProjection) {
      const key: string = JSON.stringify([
        request.sessionGeneration,
        request.identity.tenantId,
        request.identity.userId,
        request.workItemId.trim(),
        request.query.trim(),
      ]);
      const existing = inFlight.get(key);
      if (existing) return existing;

      let projection: Promise<CanonicalDocumentParsingPageResponse>;
      try {
        projection = readProjection();
      } catch (cause) {
        return Promise.reject(cause);
      }
      inFlight.set(key, projection);
      const release = (): void => {
        if (inFlight.get(key) === projection) inFlight.delete(key);
      };
      void projection.then(release, release);
      return projection;
    },
  };
}

export async function runCanonicalDocumentParsingLoad(
  callbacks: CanonicalDocumentParsingLoadCallbacks,
): Promise<void> {
  let startedIdentity: CanonicalDocumentParsingIdentity;
  try {
    startedIdentity = await callbacks.readIdentity();
  } catch (cause) {
    if (callbacks.isCurrent()) {
      callbacks.onIdentityError(cause);
      callbacks.onSettled();
    }
    return;
  }
  if (!callbacks.isCurrent()) return;

  let page: CanonicalDocumentParsingPageResponse;
  try {
    page = await callbacks.readPage(startedIdentity);
  } catch (cause) {
    if (!callbacks.isCurrent()) return;
    callbacks.onDenied(startedIdentity, cause);
    if (callbacks.isCurrent()) callbacks.onSettled();
    return;
  }
  if (!callbacks.isCurrent()) return;

  callbacks.onFresh(startedIdentity, page);
  if (callbacks.isCurrent()) callbacks.onSettled();
}
