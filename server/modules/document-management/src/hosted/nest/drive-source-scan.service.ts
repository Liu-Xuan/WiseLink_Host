import { Injectable } from '@nestjs/common';
import { driveSourceScanRoots, WISELINK_DRIVE_SOURCES } from '../wiselink-drive-source-config';
import { runDriveFolderScan } from '../drive-folder-scan-coordinator';
import type { DrivePage, DriveFolderScanResult } from '../drive-folder-scanner';
import { DriveScanCheckpointRepository } from './drive-scan-checkpoint.repository';
import { toDriveSourceCandidates, type DriveSourceCandidate } from '../drive-source-candidate';

export interface AuthorizedDrivePageFetcher {
  list(folderToken: string, pageToken?: string): Promise<DrivePage>;
}

export interface DriveSourceScanCandidates {
  scan: DriveFolderScanResult;
  candidates: DriveSourceCandidate[];
}

/** Host-owned source scan entry point. Credentials and scheduling stay outside this service. */
@Injectable()
export class DriveSourceScanService {
  constructor(private readonly checkpoints: DriveScanCheckpointRepository) {}

  async scan(input: {
    tenantId: string;
    sourceKey: string;
    fetcher: AuthorizedDrivePageFetcher;
    maxPages?: number;
    maxEntries?: number;
  }): Promise<DriveFolderScanResult> {
    const source = WISELINK_DRIVE_SOURCES.find(item => item.sourceKey === input.sourceKey && item.enabled);
    if (!source) throw new Error('DRIVE_SOURCE_NOT_REGISTERED');
    if (!input.tenantId) throw new Error('DRIVE_SCAN_TENANT_REQUIRED');
    const roots = driveSourceScanRoots([source]);
    return runDriveFolderScan({
      sourceKey: source.sourceKey,
      roots,
      fetchPage: (folderToken, pageToken) => input.fetcher.list(folderToken, pageToken),
      checkpoints: this.checkpoints.forTenant(input.tenantId),
      maxPages: input.maxPages,
      maxEntries: input.maxEntries,
    });
  }

  async scanCandidates(input: {
    tenantId: string;
    sourceKey: string;
    fetcher: AuthorizedDrivePageFetcher;
    maxPages?: number;
    maxEntries?: number;
  }): Promise<DriveSourceScanCandidates> {
    const scan = await this.scan(input);
    return { scan, candidates: toDriveSourceCandidates(input.sourceKey, scan.entries) };
  }
}
