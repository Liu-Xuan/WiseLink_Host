/**
 * Local real MCP transport identity-edge verification.
 *
 * Exercises the REAL chain on a real local HTTP transport:
 *   CanonicalHostMcpOpenApiController
 *     -> AilyNativeFinalUserIdentityService (real jsonwebtoken verify)
 *     -> AilyCanonicalServiceScopeAuthorization (real request-context actor gate)
 *     -> CanonicalHostMcpService (real MCP SDK server)
 *     -> authorizeWorkItemRead -> objectAccess.freshRead (owner fresh-read)
 *
 * Only two seams are stubbed, both documented as non-proof:
 *   1. AuthNPaasService.getBatchMiaodaUserIds (no hosted platform here);
 *   2. the WorkItem repository owner binding behind the object-access port.
 *
 * The JWT is signed with a LOCAL verification secret supplied to this script.
 * This proves the transport identity edge only; it is NOT G0 proof — no real
 * Aily-issued signed x-aily-jwt is available locally (external blocker, see
 * docs/R08_REV214_CANARY_NONCLAIMS_20260825.md).
 */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import jsonwebtoken from 'jsonwebtoken';
import {
  Client,
  StreamableHTTPClientTransport,
} from '@modelcontextprotocol/client';
import { RequestContextService } from '@lark-apaas/nestjs-common';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const moduleRoot = join(root, 'dist/server/modules/canonical-host');
const workItemRoot = join(root, 'dist/server/modules/work-item');

const { CanonicalHostMcpOpenApiController } = await import(
  pathToFileURL(join(moduleRoot, 'canonical-host-mcp.openapi.controller.js'))
);
const { AilyNativeFinalUserIdentityService } = await import(
  pathToFileURL(join(moduleRoot, 'aily-native-final-user-identity.service.js'))
);
const { AilyCanonicalServiceScopeAuthorization } = await import(
  pathToFileURL(
    join(moduleRoot, 'aily-canonical-service-scope.authorization.js'),
  )
);
const { CanonicalHostMcpService } = await import(
  pathToFileURL(join(moduleRoot, 'canonical-host-mcp.service.js'))
);
const { CanonicalObjectAccessRouter } = await import(
  pathToFileURL(join(workItemRoot, 'canonical-object-access.router.js'))
);
const {
  UnavailableAilyObjectAccessAdapter,
  UnavailableServiceObjectAccessAdapter,
  UnavailableSessionObjectAccessAdapter,
} = await import(
  pathToFileURL(
    join(workItemRoot, 'unavailable-canonical-object-access.adapters.js'),
  )
);
const { MiaodaHostedCanonicalObjectAccessAdapter } = await import(
  pathToFileURL(
    join(workItemRoot, 'miaoda-hosted-canonical-object-access.adapter.js'),
  )
);
const { CANONICAL_AILY_AGENT_ID } = await import(
  pathToFileURL(join(moduleRoot, 'canonical-host.constants.js'))
);

// Local-only verification secret. Never presented as a platform-issued token.
const LOCAL_SECRET = 'local-aily-identity-transport-secret';
const FEISHU_USER_ID = '7000000000000000001';
const TENANT_ID = '7000000000000000002';
const MIAODA_USER_ID = '1800000000000000001';
const WORK_ITEM_ID = 'WI-AILY-IDENTITY-LOCAL';
const OTHER_AGENT_ID = 'agent_other_entrance';

const freshOwnerReads = [];
const repository = {
  loadAuthorizationBinding: async ({ workItemId, tenantId, actorUserId }) => {
    freshOwnerReads.push({ workItemId, tenantId, actorUserId });
    return workItemId === WORK_ITEM_ID &&
      tenantId === TENANT_ID &&
      actorUserId === MIAODA_USER_ID
      ? {
          workItemId,
          revision: 3,
          tenantId,
          requestId: 'REQ-LOCAL-IDENTITY',
          documentId: 'DOC-LOCAL-IDENTITY',
          documentVersionId: 'DV-LOCAL-IDENTITY',
          requestedByUserId: MIAODA_USER_ID,
          runKey: 'RUN-LOCAL-IDENTITY',
        }
      : null;
  },
};
const objectAccess = new CanonicalObjectAccessRouter(
  new MiaodaHostedCanonicalObjectAccessAdapter(repository),
  new UnavailableAilyObjectAccessAdapter(),
  new UnavailableServiceObjectAccessAdapter(),
  new UnavailableSessionObjectAccessAdapter(),
);

const authn = {
  // Seam 1: stands in for the hosted platform ID conversion service.
  getBatchMiaodaUserIds: async (ids) =>
    ids.map((id) => (id === FEISHU_USER_ID ? MIAODA_USER_ID : null)),
};
const identity = new AilyNativeFinalUserIdentityService(authn, LOCAL_SECRET);
const requestContext = new RequestContextService();
const executorScope = {
  authorizeWorkItemRead: async () => {
    throw new Error('OPENAPI_REST_NOT_EXPECTED_IN_AILY_IDENTITY_EDGE');
  },
  authorizeDevelopmentCreate: async () => {
    throw new Error('DEVELOPMENT_CREATE_NOT_EXPECTED_IN_AILY_IDENTITY_EDGE');
  },
  assertTransport: async () => {
    throw new Error('OPENCLAW_MCP_NOT_EXPECTED_IN_AILY_IDENTITY_EDGE');
  },
  authorizeOpenClawWorkItem: async () => {
    throw new Error('OPENCLAW_NOT_EXPECTED_IN_AILY_IDENTITY_EDGE');
  },
  authorizeOpenClawAttempt: async () => {
    throw new Error('OPENCLAW_NOT_EXPECTED_IN_AILY_IDENTITY_EDGE');
  },
};
const serviceScope = new AilyCanonicalServiceScopeAuthorization(
  requestContext,
  objectAccess,
  executorScope,
);
const vertical = {
  openApiStatus: async (workItemId) => ({ workItemId, status: 'PARSED' }),
  openApiQuery: async ({ workItemId, query }) => ({
    workItemId,
    query,
    resultCount: 0,
    results: [],
  }),
  openApiDeepLink: async (workItemId) => ({
    workItemId,
    deepLink: `https://host.local/work-items/${workItemId}`,
  }),
};
const mcp = new CanonicalHostMcpService(vertical, serviceScope);
const controller = new CanonicalHostMcpOpenApiController(
  mcp,
  identity,
  requestContext,
  serviceScope,
);

const httpServer = createServer(async (request, response) => {
  if (request.url !== '/openapi/wiselink/mcp' || request.method !== 'POST') {
    response.writeHead(405, { Allow: 'POST' });
    response.end();
    return;
  }
  try {
    const body = await readJsonBody(request);
    await controller.handleWiseLinkMcp(request, response, body);
  } catch (error) {
    const statusCode =
      (error && typeof error === 'object' && 'statusCode' in error
        ? Number(error.statusCode)
        : 0) || 500;
    const code =
      error && typeof error === 'object' && 'code' in error
        ? String(error.code)
        : 'UNKNOWN';
    response.writeHead(statusCode, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ error: code }));
  }
});
await new Promise((resolveListen) =>
  httpServer.listen(0, '127.0.0.1', resolveListen),
);
const address = httpServer.address();
assert.ok(address && typeof address !== 'string');
const endpoint = new URL(
  '/openapi/wiselink/mcp',
  `http://127.0.0.1:${address.port}`,
);

function signedLocalToken(overrides = {}) {
  const exp = Math.floor(Date.now() / 1_000) + 600;
  const payload = {
    user_id: overrides.userId ?? FEISHU_USER_ID,
    tenant_id: overrides.tenantId ?? TENANT_ID,
    agent_id: overrides.agentId ?? CANONICAL_AILY_AGENT_ID,
    exp: overrides.exp ?? exp,
  };
  return jsonwebtoken.sign(payload, overrides.secret ?? LOCAL_SECRET, {
    algorithm: 'HS256',
  });
}

async function clientWithToken(token) {
  const client = new Client({ name: 'aily-identity-edge', version: '1.0.0' });
  await client.connect(
    new StreamableHTTPClientTransport(endpoint, {
      requestInit: { headers: { 'x-aily-jwt': token } },
    }),
  );
  return client;
}

function resultJson(result) {
  const content = result.content.find((item) => item.type === 'text');
  assert.ok(content && content.type === 'text');
  return JSON.parse(content.text);
}

try {
  // 1. No x-aily-jwt at all: the transport must reject before any MCP session.
  await assert.rejects(
    (async () => {
      const client = new Client({
        name: 'aily-identity-edge-missing',
        version: '1.0.0',
      });
      await client.connect(new StreamableHTTPClientTransport(endpoint));
      await client.close();
    })(),
    /initialize|401|AILY_SIGNED_IDENTITY_MISSING/i,
  );

  // 2. Bad signature: rejected before any ID conversion or MCP session.
  await assert.rejects(
    (async () => {
      const client = await clientWithToken(
        signedLocalToken({ secret: 'wrong-secret' }),
      );
      await client.close();
    })(),
    /initialize|401|AILY_SIGNED_IDENTITY_INVALID/i,
  );

  // 3. Abandoned entrance agent: rejected fail-closed.
  await assert.rejects(
    (async () => {
      const client = await clientWithToken(
        signedLocalToken({ agentId: 'agent_4krmu8apqgdky' }),
      );
      await client.close();
    })(),
    /initialize|401|AILY_SIGNED_IDENTITY_AGENT_NOT_ALLOWED/i,
  );

  // 4. Valid locally-signed token for the current entrance agent: the real
  //    controller -> identity -> request-context -> MCP chain must work and
  //    every protected tool call must fresh-read the Host owner using ONLY
  //    the verified+mapped identity (never the spoofed body fields).
  freshOwnerReads.length = 0;
  const client = await clientWithToken(signedLocalToken());
  try {
    const listed = await client.listTools();
    assert.deepEqual(
      listed.tools.map(({ name }) => name),
      ['get_parse_status', 'query_parsed_package', 'get_deep_link'],
    );

    assert.deepEqual(
      resultJson(
        await client.callTool({
          name: 'get_parse_status',
          arguments: { workItemId: WORK_ITEM_ID },
        }),
      ),
      { workItemId: WORK_ITEM_ID, status: 'PARSED' },
    );

    // Body/argument self-report must not authorize: tool inputs are
    // strict-schema; extra identity fields are rejected before any
    // repository I/O.
      const spoofed = await client.callTool({
      name: 'get_parse_status',
    arguments: {
    workItemId: WORK_ITEM_ID,
actorUserId: 'spoofed-miaoda-user',
    open_id: 'ou_spoofed_open_id',
    tenantId: 'spoofed-tenant',
    agentId: 'agent_spoofed',
    },
      });
        assert.equal(spoofed.isError, true);

      // Non-owner work item under the same verified tenant: fresh-read must
      // fail closed with 404 (object access denial), not leak data.
    const denied = await client.callTool({
      name: 'get_parse_status',
      arguments: { workItemId: 'WI-NOT-OWNED' },
    });
    assert.equal(denied.isError, true);

    // Every fresh-read so far (grant + non-owner denial) must have used ONLY
    // the verified + mapped identity — never the spoofed argument fields.
    assert.ok(
    freshOwnerReads.length >= 2,
      `expected grant and denial fresh-reads, got ${JSON.stringify(freshOwnerReads)}`,
    );
    assert.ok(
      freshOwnerReads.every(
        (read) =>
        read.actorUserId === MIAODA_USER_ID && read.tenantId === TENANT_ID,
      ),
      `owner fresh-read used only the verified identity: ${JSON.stringify(freshOwnerReads)}`,
    );

    // A different verified tenant maps to a different actor: the owner
    // fresh-read must fail closed before any repository grant.
      freshOwnerReads.length = 0;
        const otherTenantClient = await clientWithToken(
          signedLocalToken({ tenantId: '7000000000000000003' }),
          );
      try {
      const deniedTenant = await otherTenantClient.callTool({
    name: 'get_parse_status',
        arguments: { workItemId: WORK_ITEM_ID },
      });
      assert.equal(deniedTenant.isError, true);
    } finally {
      await otherTenantClient.close();
    }
    // The other-tenant actor fresh-reads under ITS OWN verified tenant and is
    // denied; it must never have read as the owner tenant.
    assert.ok(
      freshOwnerReads.every((read) => read.tenantId !== TENANT_ID),
      `other-tenant actor must not fresh-read as the owner: ${JSON.stringify(freshOwnerReads)}`,
    );
  } finally {
    await client.close();
  }

  console.log(
    JSON.stringify({
      event: 'AILY_IDENTITY_MCP_TRANSPORT_EDGE_VERIFIED',
      transport: 'LOCAL_REAL_MCP_HTTP',
      controller: 'CanonicalHostMcpOpenApiController',
      identity: 'AilyNativeFinalUserIdentityService',
      scopeAuthorization: 'AilyCanonicalServiceScopeAuthorization',
      objectAccess: 'HOST_OWNER_FRESH_READ',
      negativeCases: [
        'missing x-aily-jwt',
        'bad signature',
        'abandoned entrance agent',
        'argument identity self-report',
        'non-owner work item',
        'other-tenant actor',
      ],
      nonClaim:
        'LOCAL_SECRET-signed token is transport-edge evidence only, not G0 proof',
    }),
  );
} finally {
  await new Promise((resolveClose) => httpServer.close(resolveClose));
}

async function readJsonBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString('utf8');
  return raw.length > 0 ? JSON.parse(raw) : {};
}
