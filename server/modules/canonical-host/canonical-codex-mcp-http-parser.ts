import { json, type RequestHandler } from 'express';

/** Parse the two exact executor endpoints before the SDK's ordinary parser. */
export function createCanonicalCodexMcpHttpParser(
  basePath = process.env.CLIENT_BASE_PATH ?? '',
): RequestHandler {
  const prefix: string = basePath.endsWith('/') ? basePath.slice(0, -1) : basePath;
  const root = prefix && !prefix.startsWith('/') ? '/' + prefix : prefix;
  const paths = [`${root}/openapi/wiselink/codex-mcp`, `${root}/openapi/wiselink/aily-mcp`];
  // Omitting limit restores the default cap. The installed body-parser/raw-body
  // preserve numeric Infinity, removing this endpoint's fixed byte threshold.
  const parser: RequestHandler = json({ limit: Number.POSITIVE_INFINITY });
  return (req, res, next) => {
    if (req.method !== 'POST' || !paths.some(path => req.path === path || req.path === path + '/')) {
      next();
      return;
    }
    parser(req, res, next);
  };
}
