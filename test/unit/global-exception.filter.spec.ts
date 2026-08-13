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
    const error = Object.assign(new Error('Phase 2D validation run ID is not configured.'), {
      code: 'DOCUMENT_MANAGEMENT_VALIDATION_FORBIDDEN',
      statusCode: 403,
    });

    new GlobalExceptionFilter().catch(error, host);

    expect(status).toHaveBeenCalledWith(403);
    expect(json).toHaveBeenCalledWith({
      error: expect.objectContaining({
        code: 'DOCUMENT_MANAGEMENT_VALIDATION_FORBIDDEN',
        message: 'Phase 2D validation run ID is not configured.',
      }),
    });
  });
});
