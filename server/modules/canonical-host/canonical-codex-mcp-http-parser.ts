import { json, type RequestHandler } from 'express';

/** Parse this one endpoint before configureApp's ordinary SDK JSON parser. */
export function createCanonicalCodexMcpHttpParser(
  basePath = process.env.CLIENT_BASE_PATH ?? '',
): RequestHandler {
  const prefix: string = basePath.endsWith('/') ? basePath.slice(0, -1) : basePath;
  const path: string =
    (prefix && !prefix.startsWith('/') ? '/' + prefix : prefix) +
    '/openapi/wiselink/codex-mcp';
  // Omitting limit restores the default cap. The installed body-parser/raw-body
  // preserve numeric Infinity, removing this endpoint's fixed byte threshold.
  const parser: RequestHandler = json({ limit: Number.POSITIVE_INFINITY });
  return (req, res, next) => {
    if (req.method !== 'POST' || (req.path !== path && req.path !== path + '/')) {
      next();
      return;
    }
    parser(req, res, next);
  };
}
