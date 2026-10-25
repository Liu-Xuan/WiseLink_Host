import { json, type RequestHandler } from 'express';

// MATERIALS_READY carries both the retained materials and the exact model request.
export const CODEX_MCP_REQUEST_MAX_BYTES = 4 * 1024 * 1024;

/** Parse this one endpoint before configureApp's ordinary 1 MiB JSON parser. */
export function createCanonicalCodexMcpHttpParser(
  basePath = process.env.CLIENT_BASE_PATH ?? '',
): RequestHandler {
  const prefix: string = basePath.endsWith('/') ? basePath.slice(0, -1) : basePath;
  const path: string =
    (prefix && !prefix.startsWith('/') ? '/' + prefix : prefix) +
    '/openapi/wiselink/codex-mcp';
  const parser: RequestHandler = json({ limit: CODEX_MCP_REQUEST_MAX_BYTES });
  return (req, res, next) => {
    if (req.method !== 'POST' || (req.path !== path && req.path !== path + '/')) {
      next();
      return;
    }
    parser(req, res, (error?: unknown) => {
      if (error && typeof error === 'object' &&
          'type' in error && error.type === 'entity.too.large') {
        next(Object.assign(new Error('CANONICAL_CODEX_MCP_BODY_TOO_LARGE'), {
          code: 'CANONICAL_CODEX_MCP_BODY_TOO_LARGE', statusCode: 413,
        }));
        return;
      }
      next(error);
    });
  };
}
