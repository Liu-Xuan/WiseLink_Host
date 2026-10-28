import { createHash } from 'node:crypto';
import { hash, object } from '@server/modules/tdms-source/tdms-source.validation';
import { proofOfCurrent, resealCurrent, currentDerivedOriginal } from './tdms-current-contract.fixture';
import { syntheticReceiverFixture } from './tdms-real-receiver.fixture';
import { copyComplete } from './tdms-complete-owned.fixture';
import { adaptTdmsDailySource } from '@server/modules/tdms-source/tdms-daily-source-adapter';
import { MiaodaTdmsSourceAuthorization } from '@server/modules/tdms-source/miaoda-tdms-source-authorization';
import { MiaodaTdmsDailyArtifactStore } from '@server/modules/tdms-source/miaoda-tdms-daily-artifact-store';
import { TdmsReceiverService } from '@server/modules/tdms-source/tdms-receiver.service';
import { TdmsSourceService } from '@server/modules/tdms-source/tdms-source.service';
import type { TdmsReceiverRepository } from '@server/modules/tdms-source/tdms-receiver.repository';
import type { TdmsStoredSelection } from '@server/modules/tdms-source/tdms-receiver.types';
import type { SessionResolver } from '@server/modules/identity/session-resolver.service';
import { MemoryTdmsRepository } from './tdms-memory-double';
import { actor } from './tdms-fixtures';

// Host service-path fixture using the existing synthetic 0.2.54 DTO, not Source 0.2.92 compatibility evidence.
export function legacyOriginalServices() {
  const original = currentDerivedOriginal(),
    f = syntheticReceiverFixture();
  const prepared = adaptTdmsDailySource(original.env);
  for (const action of Object.values(f.actions))
    action.permittedMembers = copyComplete(prepared.memberClaims);
  const selection = {
    ...f.selection,
    filePath:
      'tdms-source/uploads/' +
      original.env.requestId +
      '_' +
      original.env.package.artifactBindings[0].bindingId,
  };
  f.objects.clear();
  f.objects.set(selection.filePath, {
    bytes: original.bytes,
    metadata: {
      bucketID: selection.bucketId,
      filePath: selection.filePath,
      id: selection.expectedProviderObjectId,
      name: original.env.package.artifactBindings[0].filename,
      createdBy: { userID: actor().canonicalSubject.id },
      metadata: {
        mimeType: original.env.package.artifactBindings[0].mediaType,
        contentLength: original.bytes.length,
      },
    },
  });
  let stored: TdmsStoredSelection | null = null;
  const port = {
    transaction: async <T>(fn: (db: unknown) => Promise<T>) => fn({}),
    authorities: async () => [copyComplete(f.row)],
    selection: async () => stored && copyComplete(stored),
    insertSelection: async (
      _actor: unknown,
      _authority: unknown,
      value: TdmsStoredSelection,
    ) => {
      stored ??= copyComplete(value);
      return copyComplete(stored);
    },
  } as unknown as TdmsReceiverRepository;
  const authorization = new MiaodaTdmsSourceAuthorization(port);
  const artifacts = new MiaodaTdmsDailyArtifactStore(
    f.files as any,
    f.catalog as any,
    authorization,
    port,
  );
  const session = {
    actor: actor(),
    session: {
      id: 'synthetic-opaque-session',
      revision: 1,
      expiresAt: new Date(Date.now() + 60000),
    },
  };
  const identity = { valid: true };
  const sessions = {
    withNativeBrowserIdentity: async (
      _request: unknown,
      fn: (value: unknown) => Promise<unknown>,
    ) => fn({ actor: actor(), oauthSession: identity.valid ? session : null }),
    withVerifiedNativeBrowserSql: async (fn: () => Promise<unknown>) => fn(),
    withVerifiedNativeBrowserServiceSql: async (fn: () => Promise<unknown>) =>
      fn(),
    resolve: async () => (identity.valid ? session : null),
  } as unknown as SessionResolver;
  const receiver = new TdmsReceiverService(
    port,
    authorization,
    artifacts,
    sessions,
  );
  const repository = new MemoryTdmsRepository();
  const documents = { assertRead: jest.fn() };
  const service = new TdmsSourceService(
    repository,
    authorization,
    artifacts,
    documents,
  );
  return {
    ...original,
    selection,
    f,
    identity,
    receiver,
    service,
    repository,
    documents,
    request: { headers: {} } as any,
  };
}

export function syntheticFormalOriginal() {
  const sample = currentDerivedOriginal();
  const lines = ['BOEING COMMERCIAL AIRPLANES',
    'SERVICE LETTER 737-SL-31-093 ATA: 3131-00 27 January 2026',
    'Synthetic offline original for Host receiver and exact document reading.'];
  const stream = ['BT', '/F1 12 Tf', '40 750 Td', ...lines.flatMap((line, index) =>
    [...(index ? ['0 -20 Td'] : []), `(${line}) Tj`]), 'ET'].join('\n');
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
  let body = '%PDF-1.4\n';
  const offsets = [0];
  for (const [index, value] of objects.entries()) {
    offsets.push(Buffer.byteLength(body));
    body += `${index + 1} 0 obj\n${value}\nendobj\n`;
  }
  const offset = Buffer.byteLength(body);
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const value of offsets.slice(1)) body += `${String(value).padStart(10, '0')} 00000 n \n`;
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${offset}\n%%EOF\n`;
  const bytes = Buffer.from(body);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const record = sample.env.package.records[0];
  const proof = proofOfCurrent(sample.env);
  const number = '737-SL-31-093';
  const businessVersion = { rawRevision: 'ORIGINAL ISSUE', rawIteration: null,
    confirmation: 'SOURCE_DECLARED' as const };
  proof.requestedCriteria.documentCode = number;
  for (const read of proof.reads) {
    read.owner.number = number;
    read.owner.rawHeaderIdentifier = `${number}, SB文档, A.1`;
    read.owner.businessVersion = copyComplete(businessVersion);
    read.owner.businessVersionEvidence.rawValue = businessVersion.rawRevision;
    read.owner.businessVersionEvidence.observedTotalCodepoints = businessVersion.rawRevision.length;
    read.attachments[0].filename = 'synthetic-service-letter.pdf';
    read.attachments[0].primaryMetadata.filename = 'synthetic-service-letter.pdf';
    read.attachments[0].primaryMetadata.ownerBusinessVersion = copyComplete(businessVersion);
  }
  record.number = number;
  record.rawFields.number = number;
  record.businessVersion = businessVersion;
  resealCurrent(sample.env);
  const binding = sample.env.package.artifactBindings[0];
  Object.assign(binding, { ownerSnapshotId: record.snapshotId, filename: 'synthetic-service-letter.pdf',
    blobSha256: sha256, byteLength: bytes.length });
  const { bindingId: _id, observedAt: _time, ...identity } = binding;
  binding.bindingId = 'TDMSBIND-' + hash(identity);
  Object.assign(object(sample.env.package.query.originalAcquisition), { bytesSha256: sha256, byteLength: bytes.length });
  sample.env.requestId = 'TDMSIMPORT-' + hash(sample.env.package);
  return { bytes, package: sample.env.package };
}
