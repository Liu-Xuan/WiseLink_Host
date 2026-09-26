import { CanonicalDocumentParsingSettingsController } from './canonical-document-parsing-settings.controller';
import { CanonicalDocumentParsingSettingsRepository } from './canonical-document-parsing-settings.repository';
import { CanonicalDocumentParsingSettingsService } from './canonical-document-parsing-settings.service';
import { Module } from '@nestjs/common';
import { CanonicalModelSettingsController } from './canonical-model-settings.controller';
import { CanonicalModelSettingsRepository } from './canonical-model-settings.repository';
import { CanonicalModelSettingsService } from './canonical-model-settings.service';

@Module({
  controllers: [CanonicalModelSettingsController, CanonicalDocumentParsingSettingsController],
  providers: [CanonicalModelSettingsRepository, CanonicalModelSettingsService, CanonicalDocumentParsingSettingsRepository, CanonicalDocumentParsingSettingsService],
  exports: [CanonicalModelSettingsService, CanonicalDocumentParsingSettingsService],
})
export class CanonicalModelSettingsModule {}
