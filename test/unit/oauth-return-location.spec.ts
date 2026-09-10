import {
  clearOauthReturnPath,
  readOauthReturnPath,
  rememberOauthReturnPath,
  safeOauthReturnPath,
} from '../../client/src/pages/OAuthCallbackPage/oauth-return-location';

function storage() {
  const data = new Map<string, string>();
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
    removeItem: (key: string) => {
      data.delete(key);
    },
  };
}

it('returns to the same task view only for the matching OAuth flow', () => {
  const target =
    '/work-items/WI-example/documents?node=review&tab=review#discussion';
  const saved = storage();
  expect(rememberOauthReturnPath(target, 'state-1', saved)).toBe(true);
  expect(readOauthReturnPath('state-other', saved)).toBeNull();
  expect(readOauthReturnPath('state-1', saved)).toBe(target);
  clearOauthReturnPath(saved);
  expect(readOauthReturnPath('state-1', saved)).toBeNull();
  expect(safeOauthReturnPath('/dialogues/thread-1?workItemId=WI-example')).toBe(
    '/dialogues/thread-1?workItemId=WI-example',
  );
});

it.each([
  'https://outside.example/work-items/WI-example',
  '//outside.example/work-items/WI-example',
  '/\\outside.example/work-items/WI-example',
  'javascript:alert(1)',
  '/client/oauth/callback?code=private',
  '/work-items/../client/oauth/callback',
  '/api/identity/oauth/start',
])(
  'does not restore an external or non-workspace destination: %s',
  (target) => {
    expect(safeOauthReturnPath(target)).toBeNull();
  },
);

it('a new flow replaces stale navigation and unavailable storage cannot block login', () => {
  const saved = storage();
  rememberOauthReturnPath('/dialogues/old', 'old-state', saved);
  rememberOauthReturnPath('/dialogues/new', 'new-state', saved);
  expect(readOauthReturnPath('old-state', saved)).toBeNull();
  expect(readOauthReturnPath('new-state', saved)).toBe('/dialogues/new');
  rememberOauthReturnPath(null, 'direct-flow', saved);
  expect(readOauthReturnPath('new-state', saved)).toBeNull();
  const unavailable = {
    getItem: () => {
      throw new Error('unavailable');
    },
    setItem: () => {
      throw new Error('unavailable');
    },
    removeItem: () => {
      throw new Error('unavailable');
    },
  };
  expect(rememberOauthReturnPath('/dialogues', 'state', unavailable)).toBe(
    false,
  );
  expect(readOauthReturnPath('state', unavailable)).toBeNull();
  expect(() => clearOauthReturnPath(unavailable)).not.toThrow();
  expect(rememberOauthReturnPath('/dialogues', 'state', null)).toBe(false);
});
