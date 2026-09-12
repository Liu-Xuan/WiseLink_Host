import { Injectable } from '@nestjs/common';
import { driveSourceScanRoots, WISELINK_DRIVE_SOURCES } from '../wiselink-drive-source-config';
import { runDriveFolderScan } from '../drive-folder-scan-coordinator';
import type { DrivePage, DriveFolderScanResult } from '../drive-folder-scanner';
import { DriveScanCheckpointRepository } from './drive-scan-checkpoint.repository';
import { classifyDriveSourceCandidates, decodeDriveSourceCandidates, toDriveSourceCandidates, type DriveSourceCandidate, type DriveSourceCandidateChange } from '../drive-source-candidate';

export interface AuthorizedDrivePageFetcher {
  list(folderToken: string, pageToken?: string): Promise<DrivePage>;
}

export interface DriveSourceScanCandidates {
  scan: DriveFolderScanResult;
  candidates: DriveSourceCandidate[];
  /** True only when the complete configured frontier was scanned without blockers. */
  complete: boolean;
  /** Observed positive changes do not wait for full-tree coverage. */
  changes: DriveSourceCandidateChange[];
  /** All unacknowledged observed objects, including earlier scan batches. */
  pendingCandidates: DriveSourceCandidate[];
}

/** Host-owned source scan entry point. Credentials and scheduling stay outside this service. */
@Injectable()
// Registered in DocumentManagementHostedModule.register dynamic providers.
// eslint-disable-next-line @darraghor/nestjs-typed/injectable-should-be-provided
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
    previousCandidates?: readonly DriveSourceCandidate[];
    maxPages?: number;
    maxEntries?: number;
  }): Promise<DriveSourceScanCandidates> {
    const checkpointStore = this.checkpoints.forTenant(input.tenantId);
    const previousCandidates = input.previousCandidates ?? (checkpointStore.loadCandidates ?
      await checkpointStore.loadCandidates(input.sourceKey).then(value => value ? decodeDriveSourceCandidates(value) : []) : []);
    const scan = await this.scan(input);
    const candidates = toDriveSourceCandidates(input.sourceKey, scan.entries);
    const complete = scan.continuation.length === 0 && scan.blockers.length === 0;
    const pendingCandidates = await this.checkpoints.listPendingCandidates(input.tenantId, input.sourceKey);
    return { scan, candidates, complete, pendingCandidates, changes: classifyDriveSourceCandidates(previousCandidates, candidates) };
  }
}
