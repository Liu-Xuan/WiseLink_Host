import { Logger } from '@nestjs/common';
import {
  Automation,
  BindTrigger,
} from '@lark-apaas/fullstack-nestjs-core';

import { DriveSourceScanService } from './drive-source-scan.service';
import { FeishuDriveApplicationPageFetcher } from './feishu-drive-application-page-fetcher';
import { DriveSourceAcquisitionService } from './drive-source-acquisition.service';

const INITIAL_SOURCE_KEYS = ['technical-library', 'operations'] as const;

@Automation()
// Registered by DocumentManagementHostedModule.register dynamic providers.
// eslint-disable-next-line @darraghor/nestjs-typed/injectable-should-be-provided
export class DriveSourceScanAutomation {
  private readonly logger = new Logger(DriveSourceScanAutomation.name);

  constructor(
    private readonly scans: DriveSourceScanService,
    private readonly fetcher: FeishuDriveApplicationPageFetcher,
    private readonly acquisitions: DriveSourceAcquisitionService,
  ) {}

  @BindTrigger('wiselinkDriveSourceScan')
  async scanRegisteredSources(): Promise<{
    sources: Array<{
      sourceKey: string;
      complete: boolean;
      observed: number;
      pending: number;
      blockers: string[];
      acquired: number;
      intakeBlocked: Array<{ providerObjectId: string; code: string }>;
      intakeStatus: 'DISABLED' | 'PROCESSED' | 'NOT_APPLICABLE';
      skippedUnsupported: number;
    }>;
  }> {
    const tenantId = process.env.WL_DRIVE_SCAN_TENANT_ID?.trim();
    if (!tenantId) throw new Error('DRIVE_SCAN_TENANT_NOT_CONFIGURED');

    const sources = [];
    for (const sourceKey of INITIAL_SOURCE_KEYS) {
      const result = await this.scans.scanCandidates({
        tenantId,
        sourceKey,
        fetcher: this.fetcher,
        maxPages: 50,
        maxEntries: 10_000,
      });
      const intake = sourceKey === 'technical-library'
        ? await this.acquisitions.processPending(tenantId)
        : { status: 'NOT_APPLICABLE' as const, attempted: 0,
          skippedUnsupported: 0, acquired: [], blocked: [] };
      const summary = {
        sourceKey,
        complete: result.complete,
        observed: result.candidates.length,
        pending: result.pendingCandidates.length,
        blockers: [...new Set(result.scan.blockers.map(item => item.code))],
        acquired: intake.acquired.length,
        intakeBlocked: intake.blocked,
        intakeStatus: intake.status,
        skippedUnsupported: intake.skippedUnsupported,
      };
      sources.push(summary);
      this.logger.log(
        `Drive source scan ${sourceKey}: complete=${summary.complete} observed=${summary.observed} pending=${summary.pending} intake=${summary.intakeStatus} acquired=${summary.acquired} unsupported=${summary.skippedUnsupported} blockers=${summary.blockers.join(',') || 'none'} intakeBlocked=${summary.intakeBlocked.map(item => `${item.providerObjectId}:${item.code}`).join(',') || 'none'}`,
      );
    }
    return { sources };
  }
}
