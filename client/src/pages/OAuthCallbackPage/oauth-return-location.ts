interface OauthReturnStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const KEY = 'wiselink.oauth.return-location';
const LOCAL_ORIGIN = 'https://wiselink.invalid';

/** Navigation context only; the server still verifies OAuth state and PKCE. */
export function safeOauthReturnPath(value: unknown): string | null {
  if (typeof value !== 'string' || !value.startsWith('/')) return null;
  try {
    const url = new URL(value, LOCAL_ORIGIN);
    if (
      url.origin !== LOCAL_ORIGIN ||
      !/^\/(?:library|dialogues(?:\/[^/]+)?|work-items\/[^/]+(?:\/documents)?|document-versions\/[^/]+|matters\/[^/]+|settings\/models)$/u.test(
        url.pathname,
      )
    )
      return null;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return null;
  }
}

export function readOauthReturnPath(
  state: string | null,
  storage: OauthReturnStorage | null,
): string | null {
  if (!state || !storage) return null;
  try {
    const saved = JSON.parse(storage.getItem(KEY) ?? 'null');
    return saved?.state === state ? safeOauthReturnPath(saved.path) : null;
  } catch {
    return null;
  }
}

export function rememberOauthReturnPath(
  path: string | null,
  state: string,
  storage: OauthReturnStorage | null,
): boolean {
  const safePath = safeOauthReturnPath(path);
  if (!storage) return false;
  try {
    if (!safePath) {
      storage.removeItem(KEY);
      return false;
    }
    storage.setItem(KEY, JSON.stringify({ state, path: safePath }));
    return true;
  } catch {
    // The connection can proceed; the page explicitly says it returns home.
    return false;
  }
}

export function clearOauthReturnPath(storage: OauthReturnStorage | null): void {
  try {
    storage?.removeItem(KEY);
  } catch {
    /* Optional navigation state. */
  }
}
