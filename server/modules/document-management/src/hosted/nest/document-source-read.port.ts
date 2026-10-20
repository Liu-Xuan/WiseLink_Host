import { AsyncLocalStorage } from 'node:async_hooks';
import type { Request } from 'express';
import type { TdmsDocumentUploadBinding } from './document-upload-authority';

export const DOCUMENT_SOURCE_READ = Symbol('DOCUMENT_SOURCE_READ');

/** Reconstructed from committed DVI/artifact/acquisition lineage, never a request claim. */
export interface DocumentSourceReadProvenance {
  documentVersionId: string;
  sourceArtifactId: string;
  sha256: string;
  byteLength: number;
  independentOrdinary: boolean;
  sourceBindings: TdmsDocumentUploadBinding[];
}

/** A process-local reference to the actual HTTP request, not an authorization. */
export interface DocumentSourceReadContext {
  readonly kind: 'SERVER_HTTP_DOCUMENT_SOURCE_READ';
}

const requests = new WeakMap<DocumentSourceReadContext, Request>();
const currentRequests = new AsyncLocalStorage<DocumentSourceReadContext>();

/** Server controllers retain this exact reference when spreading their context. */
export function mintDocumentSourceReadContext(
  request: Request,
): DocumentSourceReadContext {
  const context: DocumentSourceReadContext = Object.freeze({
    kind: 'SERVER_HTTP_DOCUMENT_SOURCE_READ',
  });
  requests.set(context, request);
  return context;
}

/** Carry only this HTTP request reference across the existing receipt projection call. */
export function withDocumentSourceReadRequest<T>(
  request: Request,
  operation: () => T,
): T {
  return currentRequests.run(mintDocumentSourceReadContext(request), operation);
}

/** Missing delegation stays missing; no actor/session lookup can manufacture it. */
export function currentDocumentSourceReadContext():
  | DocumentSourceReadContext
  | undefined {
  return currentRequests.getStore();
}

/** Copies and JSON values cannot recover the current request. */
export function documentSourceReadRequest(
  context: DocumentSourceReadContext | undefined,
): Request | undefined {
  return context && requests.get(context);
}

export interface DocumentSourceReadInput {
  actorUserId: string;
  tenantId: string;
  documentVersionId: string;
  sourceReadContext?: DocumentSourceReadContext;
  provenance: DocumentSourceReadProvenance;
}

export interface DocumentSourceReadPort {
  /** Call before and after I/O or cached/derived output. No import grant is reused. */
  assertCurrent(input: DocumentSourceReadInput): Promise<void>;
}
