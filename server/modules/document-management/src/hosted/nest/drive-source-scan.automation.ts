import { Logger } from '@nestjs/common';
import {
  Automation,
  BindTrigger,
} from '@lark-apaas/fullstack-nestjs-core';

import { DriveSourceScanService } from './drive-source-scan.service';
import { FeishuDriveApplicationPageFetcher } from './feishu-drive-application-page-fetcher';

const INITIAL_SOURCE_KEYS = ['technical-library', 'operations'] as const;

@Automation()
// Registered by DocumentManagementHostedModule.register dynamic providers.
// eslint-disable-next-line @darraghor/nestjs-typed/injectable-should-be-provided
export class DriveSourceScanAutomation {
  private readonly logger = new Logger(DriveSourceScanAutomation.name);

  constructor(
    private readonly scans: DriveSourceScanService,
    private readonly fetcher: FeishuDriveApplicationPageFetcher,
  ) {}

  @BindTrigger('wiselinkDriveSourceScan')
  async scanRegisteredSources(): Promise<{
    sources: Array<{
      sourceKey: string;
      complete: boolean;
      observed: number;
      pending: number;
      blockers: string[];
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
      const summary = {
        sourceKey,
        complete: result.complete,
        observed: result.candidates.length,
        pending: result.pendingCandidates.length,
        blockers: [...new Set(result.scan.blockers.map(item => item.code))],
      };
      sources.push(summary);
      this.logger.log(
        `Drive source scan ${sourceKey}: complete=${summary.complete} observed=${summary.observed} pending=${summary.pending} blockers=${summary.blockers.join(',') || 'none'}`,
      );
    }
    return { sources };
  }
}
