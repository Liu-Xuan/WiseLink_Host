import { Controller, Get } from '@nestjs/common';

import type { UnifiedReaderReadinessResponse } from '@shared/api.interface';

import { UnifiedReaderService } from './unified-reader.service';

@Controller('api/unified-reader')
export class UnifiedReaderController {
  constructor(private readonly readerService: UnifiedReaderService) {}

  @Get('readiness')
  readiness(): UnifiedReaderReadinessResponse {
    return this.readerService.readiness();
  }
}
