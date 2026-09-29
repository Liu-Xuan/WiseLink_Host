import { CanonicalModelSettingsModule } from '../../../../model-settings/canonical-model-settings.module';
import {
  DynamicModule,
  Module,
  type ModuleMetadata,
  type Provider,
} from '@nestjs/common';

import { DocumentManagementHostedController } from './document-management-hosted.controller';
import { DocumentManagementHostedService } from './document-management-hosted.service';
import { MiaodaHostedDocumentCatalog } from './miaoda-hosted-document-catalog';
import { DOCUMENT_MANAGEMENT_INGEST_AUTHORIZER } from './document-management-hosted.tokens';
import { DocumentParsingHostedController } from './document-parsing-hosted.controller';
import { DocumentParsingHostedService } from './document-parsing-hosted.service';
import { MineruRemoteWorkerClient } from './mineru-remote-worker.client';
import { DocumentOfficialPluginService } from './document-official-plugin.service';
import { DocumentStepLeaseRepository } from './document-step-lease.repository';
import { DocumentParsingRepository } from './document-parsing.repository';
import { DriveScanCheckpointRepository } from './drive-scan-checkpoint.repository';
import { DriveSourceScanService } from './drive-source-scan.service';
import { DriveSourceScanAutomation } from './drive-source-scan.automation';
import { FeishuDriveApplicationPageFetcher } from './feishu-drive-application-page-fetcher';
import { SourceIntakeRepository } from './source-intake.repository';
import { DriveSourceAcquisitionService } from './drive-source-acquisition.service';

export interface DocumentManagementHostedModuleOptions {
  imports?: ModuleMetadata['imports'];
  authorizerProvider: Provider;
}
@Module({})
export class DocumentManagementHostedModule {
  static register(
    options: DocumentManagementHostedModuleOptions,
  ): DynamicModule {
    const provider = options?.authorizerProvider;
    if (!provider || typeof provider !== 'object' || !('provide' in provider)) {
      throw new Error(
        'DocumentManagementHostedModule requires a server-bound authorizerProvider.',
      );
    }
    if (provider.provide !== DOCUMENT_MANAGEMENT_INGEST_AUTHORIZER) {
      throw new Error(
        'authorizerProvider must bind DOCUMENT_MANAGEMENT_INGEST_AUTHORIZER.',
      );
    }
    return {
      module: DocumentManagementHostedModule,
      imports: [CanonicalModelSettingsModule, ...(options.imports ?? [])],
      controllers: [DocumentManagementHostedController, DocumentParsingHostedController],
      providers: [
        provider,
        MiaodaHostedDocumentCatalog,
        DocumentManagementHostedService,
        DocumentParsingRepository,
        DocumentStepLeaseRepository,
        DocumentOfficialPluginService,
        DocumentParsingHostedService,
        MineruRemoteWorkerClient,
        DriveScanCheckpointRepository,
        DriveSourceScanService,
        FeishuDriveApplicationPageFetcher,
        SourceIntakeRepository,
        DriveSourceAcquisitionService,
        DriveSourceScanAutomation,
      ],
      exports: [
        MiaodaHostedDocumentCatalog,
        DocumentParsingRepository,
        DOCUMENT_MANAGEMENT_INGEST_AUTHORIZER,
        DocumentOfficialPluginService,
        DocumentStepLeaseRepository,
        DocumentManagementHostedService,
        DocumentParsingHostedService,
        DriveSourceScanService,
        SourceIntakeRepository,
      ],
    };
  }
}
