import { BadRequestException } from '@nestjs/common';

import type { DocumentDeliverySelection } from '@shared/api.interface';

/** Absence is intentionally distinct from an explicit registration-only choice. */
export function optionalDocumentDeliverySelection(
  value: unknown,
): DocumentDeliverySelection | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw invalidSelection();
  }
  const fields = value as Record<string, unknown>;
  if (
    Object.keys(fields).length !== 2 ||
    Object.keys(fields).some(
      (key) => key !== 'reading' && key !== 'translation',
    ) ||
    typeof fields.reading !== 'boolean' ||
    (fields.translation !== 'NONE' && fields.translation !== 'ZH_FULL')
  ) {
    throw invalidSelection();
  }
  return {
    reading: fields.reading,
    translation: fields.translation,
  };
}

function invalidSelection(): BadRequestException {
  return new BadRequestException({
    code: 'DOCUMENT_DELIVERY_SELECTION_INVALID',
    message: 'Document delivery selection is invalid.',
  });
}
