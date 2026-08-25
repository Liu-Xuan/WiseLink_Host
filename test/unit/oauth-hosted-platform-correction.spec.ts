import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(__dirname, '../..');

describe('Hosted platform OAuth correction', () => {
  it('exposes only POST start and callback API routes', async () => {
    const controller = await source(
      'server/modules/identity/oauth-flow.controller.ts',
    );
    expect(controller).toContain("@Post('start')");
    expect(controller).toContain("@Post('callback')");
    expect(controller).not.toContain("@Get('authorize')");
    expect(controller).not.toContain("@Get('callback')");
    expect(controller).not.toContain("@Query('code')");
    expect(controller).not.toContain("@Query('state')");
  });

  it('uses the official client request stack without creating a CSRF header', async () => {
    const [client, page, bootstrap] = await Promise.all([
      source('client/src/api/identity-oauth.ts'),
      source('client/src/pages/OAuthCallbackPage/OAuthCallbackPage.tsx'),
      source('server/main.ts'),
    ]);
    expect(client).toContain(
      "@lark-apaas/client-toolkit/utils/getAxiosForBackend",
    );
    expect(`${client}\n${page}`).not.toMatch(
      /X-Suda-Csrf-Token|suda-csrf-token/u,
    );
    expect(bootstrap).toContain('configureApp(app');
    expect(bootstrap).not.toMatch(/disable.*csrf|csrf.*disable/iu);
    expect(`${client}\n${page}\n${bootstrap}`).not.toMatch(
      /x-aily-jwt|WL_AILY_IDENTITY_JWT_SECRET/u,
    );
  });

  it('registers the SPA callback and keeps callback parameters ephemeral', async () => {
    const [routes, page] = await Promise.all([
      source('client/src/app.tsx'),
      source('client/src/pages/OAuthCallbackPage/OAuthCallbackPage.tsx'),
    ]);
    expect(routes).toContain('path="client/oauth/callback"');
    expect(page).toContain('window.history.replaceState');
    expect(page).not.toMatch(/localStorage|sessionStorage|logger|console[.]/u);
  });

  it('does not add protocol parameters to application logs', async () => {
    const [controller, client, page] = await Promise.all([
      source('server/modules/identity/oauth-flow.controller.ts'),
      source('client/src/api/identity-oauth.ts'),
      source('client/src/pages/OAuthCallbackPage/OAuthCallbackPage.tsx'),
    ]);
    expect(controller).not.toMatch(/Logger|console[.]/u);
    expect(client).not.toMatch(/logger|console[.]/u);
    expect(page).not.toMatch(/logger|console[.]/u);
  });
});

function source(relative: string): Promise<string> {
  return readFile(resolve(root, relative), 'utf8');
}
