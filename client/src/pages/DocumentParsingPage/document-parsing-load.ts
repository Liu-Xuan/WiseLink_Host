import type { CanonicalDocumentParsingPageResponse } from '@shared/api.interface';
import type { CanonicalHostIdentityContext } from '@client/src/api/canonical-host';

export interface CanonicalDocumentParsingLoadCallbacks {
  isCurrent(): boolean;
  readIdentity(): Promise<CanonicalHostIdentityContext>;
  readPage(): Promise<CanonicalDocumentParsingPageResponse>;
  onFresh(
    identity: CanonicalHostIdentityContext,
    page: CanonicalDocumentParsingPageResponse,
  ): void;
  onDenied(identity: CanonicalHostIdentityContext, cause: unknown): void;
  onIdentityError(cause: unknown): void;
  onSettled(): void;
}

export async function runCanonicalDocumentParsingLoad(
  callbacks: CanonicalDocumentParsingLoadCallbacks,
): Promise<void> {
  let startedIdentity: CanonicalHostIdentityContext;
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
    page = await callbacks.readPage();
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
  startedIdentity: CanonicalHostIdentityContext,
): Promise<boolean> {
  let currentIdentity: CanonicalHostIdentityContext;
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
