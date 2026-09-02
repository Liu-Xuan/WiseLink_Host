import type { ArgumentsHost } from '@nestjs/common';

import { GlobalExceptionFilter } from '../../server/common/filters/exception.filter';

describe('GlobalExceptionFilter', () => {
  it('preserves a stable server-owned 403 instead of reporting it as an internal error', () => {
    const status = jest.fn().mockReturnThis();
    const json = jest.fn();
    const response = { headersSent: false, status, json };
    const host = {
      switchToHttp: () => ({ getResponse: () => response }),
    } as unknown as ArgumentsHost;
    const error = Object.assign(
      new Error('Phase 2D validation run ID is not configured.'),
      {
        code: 'DOCUMENT_MANAGEMENT_VALIDATION_FORBIDDEN',
        statusCode: 403,
      },
    );

    new GlobalExceptionFilter().catch(error, host);

    expect(status).toHaveBeenCalledWith(403);
    expect(json).toHaveBeenCalledWith({
      error: expect.objectContaining({
        code: 'DOCUMENT_MANAGEMENT_VALIDATION_FORBIDDEN',
        message: 'Phase 2D validation run ID is not configured.',
      }),
    });
  });

  it('exposes schema remediation metadata on a stable 503', () => {
    const status = jest.fn().mockReturnThis();
    const json = jest.fn();
    const response = { headersSent: false, status, json };
    const host = {
      switchToHttp: () => ({ getResponse: () => response }),
    } as unknown as ArgumentsHost;
    const error = Object.assign(
      new Error('Required Review database schema is not ready.'),
      {
        code: 'REVIEW_SCHEMA_NOT_READY',
        statusCode: 503,
        retryable: false,
        operatorAction: 'APPLY_REQUIRED_SCHEMA_MIGRATIONS',
        details: {
          retryable: false,
          operatorAction: 'APPLY_REQUIRED_SCHEMA_MIGRATIONS',
        },
      },
    );

    new GlobalExceptionFilter().catch(error, host);

    expect(status).toHaveBeenCalledWith(503);
    expect(json).toHaveBeenCalledWith({
      error: expect.objectContaining({
        code: 'REVIEW_SCHEMA_NOT_READY',
        message: 'Required Review database schema is not ready.',
        retryable: false,
        operatorAction: 'APPLY_REQUIRED_SCHEMA_MIGRATIONS',
      }),
    });
  });
});
