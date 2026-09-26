import { createHash } from 'node:crypto';
import { documentParseRecoveryPredecessor } from '@shared/document-parsing-recovery';
import type { DocumentOriginalArtifact } from '@shared/document-original.interface';
import type { DocumentParseRow } from './document-parsing.repository';
import { DocumentOriginalStore, type DocumentOriginalBundle } from './document-original-store';

const PROVENANCE_PATH = 'original/raw-provenance.json';
const PRODUCER = { kind: 'OFFICIAL_PLUGIN_HYBRID', instanceId: 'wl-document-parser', pluginVersion: '1.0.16',
  actionKey: 'parseDocToMarkdown' };

/** Immutable predecessors remain discoverable when an intermediate copy was interrupted. */
export class DocumentOriginalRecovery {
  private constructor(private readonly ancestors: DocumentParseRow[], private readonly store: DocumentOriginalStore,
    private readonly assertActive: () => Promise<void>) {}

  static async load(run: DocumentParseRow, read: (id: string) => Promise<DocumentParseRow | null>,
    store: DocumentOriginalStore, assertActive: () => Promise<void>): Promise<DocumentOriginalRecovery> {
    const ancestors: DocumentParseRow[] = [];
    const seen: Set<string> = new Set([run.parseRunId]);
    let child: DocumentParseRow = run;
    let id: string | null = documentParseRecoveryPredecessor(child.requestId);
    while (id) {
      await assertActive();
      const parent: DocumentParseRow | null = await read(id);
      if (!parent || seen.has(id) || parent.parseRunId !== id || parent.status !== 'FAILED' ||
          parent.tenantId !== run.tenantId || parent.actorUserId !== run.actorUserId ||
          parent.documentVersionId !== run.documentVersionId ||
          !Number.isSafeInteger(parent.parseRevision) || parent.parseRevision >= child.parseRevision ||
          parent.expectedPublishedRevision !== run.expectedPublishedRevision ||
          !sameSource(run.sourceBinding, parent.sourceBinding)) throw new Error('DOCUMENT_PARSE_RECOVERY_CHAIN_INVALID');
      assertPageDescriptors(parent);
      ancestors.push(parent); seen.add(id); child = parent;
      id = documentParseRecoveryPredecessor(parent.requestId);
    }
    return new DocumentOriginalRecovery(ancestors, store, assertActive);
  }

  async read(role: DocumentOriginalArtifact['role'], relativePath: string): Promise<Uint8Array | null> {
    for (const ancestor of this.ancestors) {
      await this.assertActive();
      const bytes = await readArtifact(this.store, ancestor, role, relativePath);
      if (role === 'RAW_MARKDOWN') {
        const marker = await readArtifact(this.store, ancestor, 'MANIFEST', PROVENANCE_PATH);
        if (!bytes) {
          // A new attempt may recompute output that never reached storage. A declared
          // raw descriptor still fails on 404 in readArtifact; only an absent raw is skipped.
          if (marker) assertProvenance(marker, ancestor, null);
          continue;
        }
        const manifestProvenance = await this.assertManifestProvenance(ancestor, bytes);
        if (marker) assertProvenance(marker, ancestor, bytes);
        else if (!manifestProvenance) await this.assertLegacyOfficialProvenance(ancestor);
      }
      if (bytes) return bytes;
    }
    return null;
  }

  private async assertManifestProvenance(run: DocumentParseRow, raw: Uint8Array): Promise<boolean> {
    const manifest = await readArtifact(this.store, run, 'MANIFEST', 'original/manifest.json');
    if (!manifest) return false;
    const bundle = JSON.parse(Buffer.from(manifest).toString('utf8')) as DocumentOriginalBundle;
    const binding = bundle.original?.binding;
    const producer = bundle.original?.producer;
    if (bundle.schemaVersion !== 'wiselink.document.bundle.v1' || !binding || !producer ||
        Object.entries(PRODUCER).some(([key, value]) => producer[key as keyof typeof PRODUCER] !== value) ||
        binding.documentVersionId !== run.documentVersionId || binding.parseRunId !== run.parseRunId ||
        binding.parseRevision !== run.parseRevision || binding.sourceArtifactId !== run.sourceBinding.sourceArtifactId ||
        binding.sourceSha256 !== run.sourceBinding.pdfSha256 || binding.sourceByteLength !== run.sourceBinding.byteLength ||
        !bundle.rawMarkdown || bundle.rawMarkdown.role !== 'RAW_MARKDOWN' || bundle.rawMarkdown.readback !== 'VERIFIED')
      throw new Error('DOCUMENT_PARSE_RECOVERY_PROVENANCE_INVALID');
    const savedRaw = await this.store.read(storage(run), bundle.rawMarkdown);
    if (!Buffer.from(savedRaw).equals(Buffer.from(raw))) throw new Error('DOCUMENT_PARSE_RECOVERY_PROVENANCE_INVALID');
    return true;
  }

  private async assertLegacyOfficialProvenance(run: DocumentParseRow): Promise<void> {
    // In deployed history, legacy MinerU did not write original page checkpoints.
    // An explicit manifest producer always takes precedence over this historical evidence.
    // Undeployed alternative producers must provide their own recovery semantics before integration.
    const page = await readArtifact(this.store, run, 'MANIFEST', 'original/pages-0.json');
    if (page) {
      const chunk = JSON.parse(Buffer.from(page).toString('utf8')) as {
        pageCount?: number; pages?: Array<{ pageIndex?: number; text?: string }>;
      };
      if (!Number.isSafeInteger(chunk.pageCount) || Number(chunk.pageCount) < 1 || !Array.isArray(chunk.pages) ||
          chunk.pages.length !== Math.min(8, Number(chunk.pageCount)) ||
          chunk.pages.some((item, index) => item.pageIndex !== index || typeof item.text !== 'string'))
        throw new Error('DOCUMENT_PARSE_RECOVERY_CHECKPOINT_INVALID');
      return;
    }
    throw new Error('DOCUMENT_PARSE_RECOVERY_PROVENANCE_UNVERIFIED');
  }
}

export async function saveOriginalRaw(store: DocumentOriginalStore, run: DocumentParseRow, bytes: Uint8Array,
  record: (artifact: DocumentOriginalArtifact) => Promise<void>) {
  const marker = { schemaVersion: 'wiselink.original.raw-provenance.v1', producer: PRODUCER,
    parseRunId: run.parseRunId, parseRevision: run.parseRevision, sourceBinding: run.sourceBinding,
    rawSha256: digest(bytes), rawByteLength: bytes.length };
  // The companion is bound to the actual plugin output, before the raw upload can lose its receipt.
  await store.save(storage(run), 'MANIFEST', Buffer.from(JSON.stringify(marker)), record, PROVENANCE_PATH);
  return store.save(storage(run), 'RAW_MARKDOWN', bytes, record);
}

export async function checkCurrentRawProvenance(store: DocumentOriginalStore, run: DocumentParseRow,
  bytes: Uint8Array | null, record: (artifact: DocumentOriginalArtifact) => Promise<void>): Promise<void> {
  const marker = await readArtifact(store, run, 'MANIFEST', PROVENANCE_PATH);
  if (!marker) return;
  if (!bytes) throw new Error('DOCUMENT_PARSE_RECOVERY_RAW_NOT_PERSISTED');
  assertProvenance(marker, run, bytes);
  const descriptor = run.artifactProgress.find(item => item.relativePath === PROVENANCE_PATH);
  if (descriptor) await record({ ...descriptor, role: 'MANIFEST', readback: 'VERIFIED' });
  else {
    const recovered = await store.recover(storage(run), 'MANIFEST', PROVENANCE_PATH);
    if (!recovered || !Buffer.from(recovered.bytes).equals(Buffer.from(marker)))
      throw new Error('DOCUMENT_PARSE_RECOVERY_PROVENANCE_INVALID');
    await record(recovered.artifact);
  }
}

async function readArtifact(store: DocumentOriginalStore, run: DocumentParseRow,
  role: DocumentOriginalArtifact['role'], relativePath: string): Promise<Uint8Array | null> {
  const descriptors = run.artifactProgress.filter(item => item.relativePath === relativePath);
  if (descriptors.length > 1) throw new Error('DOCUMENT_PARSE_RECOVERY_CHECKPOINT_INVALID');
  const descriptor = descriptors[0];
  if (descriptor) {
    if (descriptor.role !== role || !['UPLOADED', 'VERIFIED'].includes(descriptor.readback))
      throw new Error('DOCUMENT_PARSE_RECOVERY_CHECKPOINT_INVALID');
    // UPLOADED receipts become usable only after normal metadata and digest readback.
    return store.read(storage(run), { ...descriptor, role });
  }
  // Probe only the exact deterministic path to recover a lost DB progress receipt.
  return (await store.recover(storage(run), role, relativePath))?.bytes ?? null;
}

function assertProvenance(bytes: Uint8Array, run: DocumentParseRow, raw: Uint8Array | null): void {
  const marker = JSON.parse(Buffer.from(bytes).toString('utf8')) as {
    schemaVersion?: string; producer?: typeof PRODUCER; parseRunId?: string; parseRevision?: number;
    sourceBinding?: DocumentParseRow['sourceBinding']; rawSha256?: string; rawByteLength?: number;
  };
  if (marker.schemaVersion !== 'wiselink.original.raw-provenance.v1' || !marker.producer ||
      Object.entries(PRODUCER).some(([key, value]) => marker.producer?.[key as keyof typeof PRODUCER] !== value) ||
      marker.parseRunId !== run.parseRunId || marker.parseRevision !== run.parseRevision || !marker.sourceBinding ||
      !sameSource(marker.sourceBinding, run.sourceBinding) || !/^[a-f0-9]{64}$/.test(marker.rawSha256 ?? '') ||
      !Number.isSafeInteger(marker.rawByteLength) || Number(marker.rawByteLength) < 1 ||
      Number(marker.rawByteLength) > 64 * 1024 * 1024 ||
      (raw !== null && (marker.rawSha256 !== digest(raw) || marker.rawByteLength !== raw.length))) throw new Error('DOCUMENT_PARSE_RECOVERY_PROVENANCE_INVALID');
}
function storage(run: DocumentParseRow) {
  return { documentVersionId: run.documentVersionId, parseRunId: run.parseRunId, bucketId: run.bucketId };
}
function digest(bytes: Uint8Array): string { return createHash('sha256').update(bytes).digest('hex'); }
function sameSource(left: DocumentParseRow['sourceBinding'], right: DocumentParseRow['sourceBinding']): boolean {
  return left.documentVersionId === right.documentVersionId && left.documentId === right.documentId &&
    left.familyId === right.familyId && left.sourceArtifactId === right.sourceArtifactId &&
    left.pdfSha256 === right.pdfSha256 && left.byteLength === right.byteLength;
}

function assertPageDescriptors(run: DocumentParseRow): void {
  const pages = run.artifactProgress.filter(item => /^original\/pages-/.test(item.relativePath));
  const starts = pages.map(item => {
    const match = /^original\/pages-(0|[1-9][0-9]*)\.json$/.exec(item.relativePath);
    if (!match || item.role !== 'MANIFEST' || !['UPLOADED', 'VERIFIED'].includes(item.readback))
      throw new Error('DOCUMENT_PARSE_RECOVERY_CHECKPOINT_INVALID');
    return Number(match[1]);
  }).sort((left, right) => left - right);
  if (starts.some((start, index) => !Number.isSafeInteger(start) || start !== index * 8))
    throw new Error('DOCUMENT_PARSE_RECOVERY_CHECKPOINT_INVALID');
}
