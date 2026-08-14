import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { FileService } from '@lark-apaas/fullstack-nestjs-core';
import { Injectable } from '@nestjs/common';

import type {
  CanonicalPdfVerticalRunRequest,
  UnifiedPackageArtifactDescriptor,
} from '@shared/api.interface';
import { MiaodaFileServiceArtifactStore } from '../document-management/src/hosted/miaodaFileServiceArtifactStore.js';
import { MiaodaDocumentVersionSourceResolver } from '../work-item/miaoda-document-version-source.resolver';
import { U0FullValidationService } from '../unified-reader/u0-full-validation.service';
import { sha256Raw } from '../unified-reader/unified-reader.utils';
import type {
  CanonicalPdfProducerPort,
  CanonicalPdfProducerResult,
} from './canonical-host.types';

const PACKAGE_ID =
  'urn:techpub:package:v1:sha256:9e734a0de1c37c368b954662e9bb11036cc24b430468a073b31da127380df622';
const SOURCE_SHA256 =
  'b1b5c198df4a3d42925218f48d70ddc361563c65692be35dac4c81e0d8367a3c';
const SOURCE_BYTE_LENGTH = 122_102;
const DOCUMENT_ID = 'document_3943d8eb5b7c7ee8fc742092';
const DOCUMENT_VERSION_ID = 'document_version_fd88dcb9cf64cf3ba21033ef';
const ASSET_NAME = 'real-ftd-frozen2.unified-package.json';

@Injectable()
export class ExactFtdFrozen2PdfProducerAdapter
  implements CanonicalPdfProducerPort
{
  constructor(
    private readonly fileService: FileService,
    private readonly resolver: MiaodaDocumentVersionSourceResolver,
    private readonly validator: U0FullValidationService,
  ) {}

  async producePdf(
    request: CanonicalPdfVerticalRunRequest,
  ): Promise<CanonicalPdfProducerResult> {
    if (
      request.source.documentId !== DOCUMENT_ID ||
      request.source.documentVersionId !== DOCUMENT_VERSION_ID ||
      request.source.sourceFileSha256 !== `sha256:${SOURCE_SHA256}` ||
      request.source.sourceByteLength !== SOURCE_BYTE_LENGTH ||
      request.classification.normalizedFamily !== 'FTD'
    ) {
      return {
        kind: 'FAILURE_SIGNAL',
        failureCode: 'PDF_PRODUCER_PROFILE_NOT_AVAILABLE',
        message: 'The first hosted slice currently activates only the verified real FTD profile.',
        executionRoute: 'dm_document_version->exact_ftd_frozen2_adapter',
      };
    }
    const resolved = await this.resolver.resolve(DOCUMENT_VERSION_ID);
    const sourceStore = new MiaodaFileServiceArtifactStore(this.fileService);
    const selection = await sourceStore.readSelection({
      bucketId: resolved.artifact.bucketId,
      filePath: resolved.artifact.filePath,
    });
    if (
      selection.readbackVerified !== true ||
      selection.sha256 !== SOURCE_SHA256 ||
      Number(selection.byteLength) !== SOURCE_BYTE_LENGTH ||
      selection.providerObjectId !== resolved.artifact.providerObjectId
    ) {
      throw new Error('PDF_PRODUCER_SOURCE_READBACK_MISMATCH');
    }

    const bytes = await readPackageAsset();
    const parsed = JSON.parse(Buffer.from(bytes).toString('utf8')) as Record<
      string,
      unknown
    >;
    assertPackageSourceBinding(parsed);
    const artifact: UnifiedPackageArtifactDescriptor = {
      storeRole: 'UnifiedArtifactStoreCandidate',
      ref: `artifact://UnifiedArtifactStoreCandidate/unified-parsed-packages/sha256/${sha256Raw(bytes)}`,
      sha256: sha256Raw(bytes),
      byteLength: bytes.byteLength,
      mediaType: 'application/json',
    };
    await this.validator.validate({ artifact, bytes, packageId: PACKAGE_ID });
    return {
      kind: 'PACKAGE',
      packageId: PACKAGE_ID,
      contractId: 'techpub.parsed-package.v1',
      contractRevision: 'frozen.2',
      bytes,
      strictReaderValidated: true,
      executionRoute:
        'file_service_source->exact_ftd_producer_output->u0_frozen2_strict_validator',
    };
  }
}

async function readPackageAsset(): Promise<Uint8Array> {
  const candidates = [
    resolve(
      process.cwd(),
      'dist/server/runtime-assets/first-vertical',
      ASSET_NAME,
    ),
    resolve(process.cwd(), 'test/fixtures', ASSET_NAME),
    resolve(__dirname, '../../runtime-assets/first-vertical', ASSET_NAME),
  ];
  for (const path of candidates) {
    try {
      return new Uint8Array(await readFile(path));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  throw new Error('PDF_PRODUCER_ASSET_NOT_PACKAGED');
}

function assertPackageSourceBinding(value: Record<string, unknown>): void {
  const source = value.source as Record<string, unknown> | undefined;
  const artifacts = value.artifacts as Array<Record<string, unknown>> | undefined;
  const legacy = source?.legacyIdentifiers as
    | Array<Record<string, unknown>>
    | undefined;
  const sourceArtifact = artifacts?.find(
    (artifact) => artifact.origin === 'source' && artifact.role === 'pdf',
  );
  const legacyMap = new Map(
    (legacy ?? []).map((item) => [String(item.namespace), String(item.value)]),
  );
  if (
    value.packageId !== PACKAGE_ID ||
    value.schemaVersion !== 'techpub.parsed-package.v1' ||
    value.contractRevision !== 'frozen.2' ||
    source?.sourcePackageHash !== `sha256:${SOURCE_SHA256}` ||
    legacyMap.get('wiselink_document_id') !== DOCUMENT_ID ||
    legacyMap.get('wiselink_document_version_id') !== DOCUMENT_VERSION_ID ||
    sourceArtifact?.sha256 !== `sha256:${SOURCE_SHA256}` ||
    Number(sourceArtifact?.byteLength) !== SOURCE_BYTE_LENGTH
  ) {
    throw new Error('PDF_PRODUCER_PACKAGE_SOURCE_BINDING_MISMATCH');
  }
}
