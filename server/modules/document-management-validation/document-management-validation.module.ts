import { Module } from '@nestjs/common';

import { DocumentManagementRuntimeModule } from '../document-management-runtime/document-management-runtime.module';
import { Phase2dValidationController } from './phase2d-validation.controller';
import { Phase2dValidationService } from './phase2d-validation.service';

@Module({
  imports: [DocumentManagementRuntimeModule],
  controllers: [Phase2dValidationController],
  providers: [Phase2dValidationService],
})
export class DocumentManagementValidationModule {}
