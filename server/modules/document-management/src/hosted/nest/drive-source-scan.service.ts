import { Injectable } from '@nestjs/common';
import { driveSourceScanRoots, WISELINK_DRIVE_SOURCES } from '../wiselink-drive-source-config';
import { runDriveFolderScan } from '../drive-folder-scan-coordinator';
import type { DrivePage, DriveFolderScanResult } from '../drive-folder-scanner';
import { DriveScanCheckpointRepository } from './drive-scan-checkpoint.repository';
import { classifyDriveSourceCandidates, decodeDriveSourceCandidates, encodeDriveSourceCandidates, toDriveSourceCandidates, type DriveSourceCandidate, type DriveSourceCandidateChange } from '../drive-source-candidate';

export interface AuthorizedDrivePageFetcher {
  list(folderToken: string, pageToken?: string): Promise<DrivePage>;
}

export interface DriveSourceScanCandidates {
  scan: DriveFolderScanResult;
  candidates: DriveSourceCandidate[];
  /** True only when the complete configured frontier was scanned without blockers. */
  complete: boolean;
  /** Identity changes are emitted only from a complete scan. */
  changes: DriveSourceCandidateChange[];
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
    previousCandidates?: readonly DriveSourceCandidate[];
    maxPages?: number;
    maxEntries?: number;
  }): Promise<DriveSourceScanCandidates> {
    const scan = await this.scan(input);
    const candidates = toDriveSourceCandidates(input.sourceKey, scan.entries);
    const checkpointStore = this.checkpoints.forTenant(input.tenantId);
    const previousCandidates = input.previousCandidates ?? (checkpointStore.loadCandidates ?
      await checkpointStore.loadCandidates(input.sourceKey).then(value => value ? decodeDriveSourceCandidates(value) : []) : []);
    // A partial or blocked scan must not replace the last complete identity snapshot.
    if (scan.continuation.length === 0 && scan.blockers.length === 0 && checkpointStore.saveCandidates) {
      await checkpointStore.saveCandidates(input.sourceKey, encodeDriveSourceCandidates(candidates));
    }
    const complete = scan.continuation.length === 0 && scan.blockers.length === 0;
    return { scan, candidates, complete, changes: complete ? classifyDriveSourceCandidates(previousCandidates, candidates) : [] };
  }
}
