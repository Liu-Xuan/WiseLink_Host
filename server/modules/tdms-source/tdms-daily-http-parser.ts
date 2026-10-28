import { json, type RequestHandler } from 'express';
import { COMPLETE_OWN_REQUEST_MAX_BYTES } from './tdms-complete-owned-source.validation';
import { tdmsError } from './tdms-source.types';

/** Register before configureApp; the SDK keeps its existing parser for every other route. */
export function createTdmsDailyHttpParser(
  basePath = process.env.CLIENT_BASE_PATH ?? '',
): RequestHandler {
  // Match the global prefix normalization used by Nest's route path factory.
  const prefix = basePath.endsWith('/') ? basePath.slice(0, -1) : basePath;
  const path =
    (prefix && !prefix.startsWith('/') ? '/' + prefix : prefix) +
    '/api/tdms-source-imports';
  const parser = json({ limit: COMPLETE_OWN_REQUEST_MAX_BYTES });
  return (req, res, next) => {
    const suffix = req.path.startsWith(path + '/')
      ? req.path.slice(path.length)
      : '';
    const packageRoute =
      /^\/[^/]+\/artifacts\/[^/]+\/(?:selection(?:\/preflight)?|registration)\/?$/u.test(suffix);
    if (
      req.method !== 'POST' ||
      (req.path !== path && req.path !== path + '/' && !packageRoute)
    ) {
      next();
      return;
    }
    parser(req, res, (error?: unknown) => {
      if (
        error &&
        typeof error === 'object' &&
        'type' in error &&
        error.type === 'entity.too.large'
      ) {
        next(tdmsError('TDMS_SOURCE_IMPORT_BODY_TOO_LARGE', 413));
        return;
      }
      next(error);
    });
  };
}
