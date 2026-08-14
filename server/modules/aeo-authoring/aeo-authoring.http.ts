import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';

import { AeoEditorProjectionError } from './aeo-editor-projection.utils';

export function rethrowAeoAuthoringHttpError(error: unknown): never {
  if (error instanceof AeoEditorProjectionError) {
    const payload = {
      code: error.code,
      message: error.message,
    };
    if (
      error.code === 'AEO_WORKING_COPY_CONFLICT' ||
      error.code === 'AEO_CHECKPOINT_REQUIRES_SAVED_WORKING_COPY'
    ) {
      throw new ConflictException(payload);
    }
    if (error.code === 'AEO_CLOUD_DOCUMENT_NOT_FOUND') {
      throw new NotFoundException(payload);
    }
    if (error.code === 'AEO_SPECIALIST_SOURCE_NOT_FOUND') {
      throw new NotFoundException(payload);
    }
    if (error.code === 'AEO_AILY_REQUESTER_UNAVAILABLE') {
      throw new ServiceUnavailableException(payload);
    }
    throw new BadRequestException({
      ...payload,
    });
  }
  throw error;
}
