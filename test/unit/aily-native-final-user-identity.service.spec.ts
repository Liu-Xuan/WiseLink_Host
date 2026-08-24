import * as jsonwebtoken from 'jsonwebtoken';

import { AilyNativeFinalUserIdentityService } from '../../server/modules/canonical-host/aily-native-final-user-identity.service';
import { CANONICAL_AILY_AGENT_ID } from '../../server/modules/canonical-host/canonical-host.constants';

const SECRET = 'unit-test-aily-identity-secret';
const FEISHU_USER_ID = '7620774801438674448';
const TENANT_ID = '7283059256756502547';
const MIAODA_USER_ID = '1812345678901234567';
const AGENT_ID = CANONICAL_AILY_AGENT_ID;

describe('AilyNativeFinalUserIdentityService', () => {
  it('verifies the native JWT and preserves exact platform identifiers', async () => {
    const authn = {
      getBatchMiaodaUserIds: jest.fn().mockResolvedValue([MIAODA_USER_ID]),
    };
    const service = new AilyNativeFinalUserIdentityService(
      authn as never,
      SECRET,
    );

    const result = await service.verifyAndMap(await signedToken());

    expect(authn.getBatchMiaodaUserIds).toHaveBeenCalledWith([FEISHU_USER_ID]);
    expect(result.actor).toMatchObject({
      transport: 'AILY_SIGNED_MCP_HTTP',
      canonicalSubject: {
        namespace: 'MIAODA_USER_ID',
        id: MIAODA_USER_ID,
      },
      tenantId: TENANT_ID,
      applicationScopeId: 'app_17bzc551rsg',
      identityProvenance: 'AILY_SIGNED_JWT',
      feishuUserId: FEISHU_USER_ID,
      agentId: AGENT_ID,
    });
    expect(result.actorFingerprint).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it('fails closed before ID conversion for a bad signature', async () => {
    const authn = { getBatchMiaodaUserIds: jest.fn() };
    const service = new AilyNativeFinalUserIdentityService(
      authn as never,
      'different-secret',
    );

    await expect(
      service.verifyAndMap(await signedToken()),
    ).rejects.toMatchObject({
      code: 'AILY_SIGNED_IDENTITY_INVALID',
      statusCode: 401,
    });
    expect(authn.getBatchMiaodaUserIds).not.toHaveBeenCalled();
  });

  it('fails closed before ID conversion for any other Aily agent', async () => {
    const authn = { getBatchMiaodaUserIds: jest.fn() };
    const service = new AilyNativeFinalUserIdentityService(
      authn as never,
      SECRET,
    );

    await expect(
      service.verifyAndMap(await signedToken('agent_not_wiselink')),
    ).rejects.toMatchObject({
      code: 'AILY_SIGNED_IDENTITY_AGENT_NOT_ALLOWED',
      statusCode: 401,
    });
    expect(authn.getBatchMiaodaUserIds).not.toHaveBeenCalled();
  });

  it('fails closed when the hosted secret is unavailable', async () => {
    const service = new AilyNativeFinalUserIdentityService({} as never, null);

    await expect(service.verifyAndMap('signed-token')).rejects.toMatchObject({
      code: 'AILY_IDENTITY_JWT_SECRET_UNAVAILABLE',
      statusCode: 503,
    });
  });
});

async function signedToken(agentId = AGENT_ID): Promise<string> {
  const exp = Math.floor(Date.now() / 1_000) + 600;
  const payload = `{"user_id":${FEISHU_USER_ID},"tenant_id":${TENANT_ID},"agent_id":"${agentId}","exp":${exp}}`;
  return jsonwebtoken.sign(payload, SECRET, {
    algorithm: 'HS256',
    header: { typ: 'JWT' },
  });
}
