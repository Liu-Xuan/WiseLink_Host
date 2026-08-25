import { BadRequestException } from '@nestjs/common';

import type { CanonicalDevelopmentWorkItemRunRequest } from '@shared/api.interface';

const ALLOWED_KEYS = new Set([
  'documentVersionId',
  'selection',
  'developmentRunToken',
  'query',
]);

const FORBIDDEN_AUTHORITY_KEYS = new Set([
  'actor',
  'roles',
  'tenantId',
  'userId',
  'authority',
  'decisionId',
  'permissionSnapshotVersion',
]);

export function developmentRunBody(
  body: unknown,
): CanonicalDevelopmentWorkItemRunRequest {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw badRequest('DEVELOPMENT_RUN_REQUEST_BODY_INVALID');
  }
  const value = body as Record<string, unknown>;
  for (const key of Object.keys(value)) {
    if (FORBIDDEN_AUTHORITY_KEYS.has(key)) {
      throw badRequest(
        `DEVELOPMENT_RUN_REQUEST_INVALID:SELF_REPORTED_AUTHORITY:${key}`,
      );
    }
    if (!ALLOWED_KEYS.has(key)) {
      throw badRequest(`DEVELOPMENT_RUN_REQUEST_INVALID:UNKNOWN_FIELD:${key}`);
    }
  }
  const documentVersionId = optionalText(
    value.documentVersionId,
    'documentVersionId',
  );
  const selection = optionalSelection(value.selection);
  if ((documentVersionId ? 1 : 0) + (selection ? 1 : 0) !== 1) {
    throw badRequest('DEVELOPMENT_RUN_SOURCE_EXACTLY_ONE_REQUIRED');
  }
  return {
    ...(documentVersionId ? { documentVersionId } : { selection }),
    developmentRunToken: requiredText(
      value.developmentRunToken,
      'developmentRunToken',
    ),
    query:
      value.query === undefined
        ? undefined
        : requiredText(value.query, 'query'),
  };
}

function optionalSelection(
  value: unknown,
): { bucketId: string; filePath: string } | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw badRequest('DEVELOPMENT_RUN_SELECTION_INVALID');
  }
  const selection = value as Record<string, unknown>;
  const keys = Object.keys(selection);
  if (
    keys.some((key) => key !== 'bucketId' && key !== 'filePath') ||
    keys.length !== 2
  ) {
    throw badRequest('DEVELOPMENT_RUN_SELECTION_INVALID');
  }
  return {
    bucketId: requiredText(selection.bucketId, 'selection.bucketId'),
    filePath: requiredText(selection.filePath, 'selection.filePath'),
  };
}

function optionalText(value: unknown, field: string): string | undefined {
  if (value === undefined) return undefined;
  return requiredText(value, field);
}

function requiredText(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw badRequest(`DEVELOPMENT_RUN_${field.toUpperCase()}_REQUIRED`);
  }
  return value.trim();
}

function badRequest(code: string): BadRequestException {
  return new BadRequestException({ code, message: code });
}
