import { Module } from '@nestjs/common';
import { CanonicalModelSettingsController } from './canonical-model-settings.controller';
import { CanonicalModelSettingsRepository } from './canonical-model-settings.repository';
import { CanonicalModelSettingsService } from './canonical-model-settings.service';

@Module({
  controllers: [CanonicalModelSettingsController],
  providers: [CanonicalModelSettingsRepository, CanonicalModelSettingsService],
  exports: [CanonicalModelSettingsService],
})
export class CanonicalModelSettingsModule {}
