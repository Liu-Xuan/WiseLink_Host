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
  workItemId: string;
  query: string;
}

export interface CanonicalDocumentParsingProjectionReader {
  read(
    request: CanonicalDocumentParsingProjectionRequest,
    readProjection: () => Promise<CanonicalDocumentParsingPageResponse>,
  ): Promise<CanonicalDocumentParsingPageResponse>;
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
    const identityConfirmed = await confirmIdentity(callbacks, startedIdentity);
    if (!identityConfirmed || !callbacks.isCurrent()) return;
    callbacks.onDenied(startedIdentity, cause);
    if (callbacks.isCurrent()) callbacks.onSettled();
    return;
  }
  if (!callbacks.isCurrent()) return;

  const identityConfirmed = await confirmIdentity(callbacks, startedIdentity);
  if (!identityConfirmed || !callbacks.isCurrent()) return;
  callbacks.onFresh(startedIdentity, page);
  if (callbacks.isCurrent()) callbacks.onSettled();
}

async function confirmIdentity(
  callbacks: CanonicalDocumentParsingLoadCallbacks,
  startedIdentity: CanonicalDocumentParsingIdentity,
): Promise<boolean> {
  let currentIdentity: CanonicalDocumentParsingIdentity;
  try {
    currentIdentity = await callbacks.readIdentity();
  } catch {
    return false;
  }
  return (
    callbacks.isCurrent() &&
    currentIdentity.userId === startedIdentity.userId &&
    currentIdentity.tenantId === startedIdentity.tenantId
  );
}
