import { WISELINK_DRIVE_SOURCES } from '../wiselink-drive-source-config';
import type { DocumentDeliverySelection } from '@shared/api.interface';
import {
  isMintedDocumentUploadAuthority,
  type DocumentUploadAuthority,
} from './document-upload-authority';

export interface SourceDelegationPolicy {
  tenantId: string;
  sourceKey: string;
  rootToken: string;
  policyRevision: string;
  responsibilityActorUserId: string;
  executorPrincipalId: string;
  enabled: boolean;
  documentDelivery: DocumentDeliverySelection;
  engineeringMode: 'DOCUMENT_ONLY' | 'AUTHORIZED_SCOPE';
}

/** Exact metadata binding only; the future scanner adapter must verify root membership. */
export interface SourceObservationBinding {
  sourceKey: string;
  rootToken: string;
  providerObjectId: string;
  providerVersionId: string;
  selectionBucketId: string;
  selectionFilePath: string;
}

export interface SourceDelegationAuthority {
  readonly kind: 'SOURCE_DELEGATION';
  readonly policy: SourceDelegationPolicy;
  readonly observation: SourceObservationBinding;
}
export interface SourceReceiptReadAuthority {
  readonly kind: 'SOURCE_RECEIPT_READ';
  readonly tenantId: string;
  readonly sourceKey: string;
  readonly rootToken: string;
  readonly responsibilityActorUserId: string;
  readonly executorPrincipalId: string;
}

export type SourceIntakeAuthority = DocumentUploadAuthority | SourceDelegationAuthority;
const mintedSources = new WeakSet<object>();
const mintedReceiptReaders = new WeakSet<object>();

/** A registry entry alone is never a processing grant. Invalid or absent config closes the source. */
export function parseSourceDelegationPolicy(raw: string | undefined): SourceDelegationPolicy[] {
  if (!raw?.trim()) return [];
  let value: unknown;
  try { value = JSON.parse(raw); } catch { throw new Error('SOURCE_POLICY_INVALID'); }
  if (!Array.isArray(value)) throw new Error('SOURCE_POLICY_INVALID');
  const policies = value.map((item: unknown) => {
    if (!isRecord(item) || !exactKeys(item, [
      'tenantId', 'sourceKey', 'rootToken', 'policyRevision',
      'responsibilityActorUserId', 'executorPrincipalId', 'enabled',
      'documentDelivery', 'engineeringMode',
    ]) || typeof item.enabled !== 'boolean' || !isText(item.tenantId) ||
      !isText(item.sourceKey) || !isText(item.rootToken) ||
      !isText(item.policyRevision) || !isText(item.responsibilityActorUserId) ||
      !isText(item.executorPrincipalId) ||
      !validDelivery(item.documentDelivery) ||
      !['DOCUMENT_ONLY', 'AUTHORIZED_SCOPE'].includes(String(item.engineeringMode))) {
      throw new Error('SOURCE_POLICY_INVALID');
    }
    const registered = WISELINK_DRIVE_SOURCES.find(source =>
      source.sourceKey === item.sourceKey && source.folderToken === item.rootToken);
    if (!registered || !registered.enabled) throw new Error('SOURCE_POLICY_ROOT_MISMATCH');
    if (item.sourceKey === 'operations' &&
      item.engineeringMode !== 'DOCUMENT_ONLY') {
      throw new Error('SOURCE_POLICY_ENGINEERING_SCOPE_DENIED');
    }
    return {
      tenantId: item.tenantId,
      sourceKey: item.sourceKey,
      rootToken: item.rootToken,
      policyRevision: item.policyRevision,
      responsibilityActorUserId: item.responsibilityActorUserId,
      executorPrincipalId: item.executorPrincipalId,
      enabled: item.enabled,
      documentDelivery: {
        reading: item.documentDelivery.reading,
        translation: item.documentDelivery.translation,
      },
      engineeringMode: item.engineeringMode,
    } as SourceDelegationPolicy;
  });
  const keys = policies.map(policy => `${policy.tenantId}:${policy.sourceKey}`);
  if (new Set(keys).size !== keys.length) throw new Error('SOURCE_POLICY_DUPLICATE');
  return policies;
}

/** Internal port; no caller is wired until a scanner proves root membership and bytes. */
export function mintSourceDelegationAuthority(input: {
  tenantId: string;
  sourceKey: string;
  observation: SourceObservationBinding;
}): SourceDelegationAuthority {
  const policy = parseSourceDelegationPolicy(process.env.WISELINK_SOURCE_INTAKE_POLICIES_JSON)
    .find(item => item.tenantId === input.tenantId && item.sourceKey === input.sourceKey);
  if (!policy || !policy.enabled) throw new Error('SOURCE_DELEGATION_NOT_CONFIGURED');
  const { observation } = input;
  if (!policy.enabled || policy.sourceKey !== observation.sourceKey ||
    policy.rootToken !== observation.rootToken || !isText(observation.providerObjectId) ||
    !isText(observation.providerVersionId) || !isText(observation.selectionBucketId) ||
    !isText(observation.selectionFilePath)) {
    throw new Error('SOURCE_DELEGATION_SCOPE_MISMATCH');
  }
  const authority = Object.freeze({ kind: 'SOURCE_DELEGATION' as const,
    policy: Object.freeze({ ...policy, documentDelivery: Object.freeze({ ...policy.documentDelivery }) }),
    observation: Object.freeze({ ...observation }) });
  mintedSources.add(authority);
  return authority;
}

export function isMintedSourceDelegationAuthority(value: unknown): value is SourceDelegationAuthority {
  return Boolean(value && typeof value === 'object' && mintedSources.has(value));
}

/** Control-plane metadata only. Works during a pause, not after policy removal. */
export function mintSourceReceiptReadAuthority(input: { tenantId: string;
  sourceKey: string }): SourceReceiptReadAuthority {
  const policy = parseSourceDelegationPolicy(process.env.WISELINK_SOURCE_INTAKE_POLICIES_JSON)
    .find(item => item.tenantId === input.tenantId && item.sourceKey === input.sourceKey);
  if (!policy) throw new Error('SOURCE_RECEIPT_READ_NOT_CONFIGURED');
  const authority = Object.freeze({ kind: 'SOURCE_RECEIPT_READ' as const,
    tenantId: policy.tenantId, sourceKey: policy.sourceKey,
    rootToken: policy.rootToken,
    responsibilityActorUserId: policy.responsibilityActorUserId,
    executorPrincipalId: policy.executorPrincipalId });
  mintedReceiptReaders.add(authority);
  return authority;
}

export function assertSourceReceiptReadAuthority(input: { authority:
  DocumentUploadAuthority | SourceReceiptReadAuthority;
  tenantId: string; actorUserId: string }): void {
  if (isMintedDocumentUploadAuthority(input.authority, input)) return;
  if (input.authority?.kind !== 'SOURCE_RECEIPT_READ' ||
    !mintedReceiptReaders.has(input.authority))
    throw new Error('SOURCE_RECEIPT_READ_AUTHORITY_REQUIRED');
  const authority = input.authority;
  const policy = parseSourceDelegationPolicy(process.env.WISELINK_SOURCE_INTAKE_POLICIES_JSON)
    .find(item => item.tenantId === input.tenantId &&
      item.sourceKey === authority.sourceKey);
  if (!policy ||
    authority.tenantId !== input.tenantId ||
    authority.responsibilityActorUserId !== input.actorUserId ||
    policy.rootToken !== authority.rootToken ||
    policy.responsibilityActorUserId !== authority.responsibilityActorUserId ||
    policy.executorPrincipalId !== authority.executorPrincipalId) {
    throw new Error('SOURCE_RECEIPT_READ_AUTHORITY_REQUIRED');
  }
}

export function assertSourceIntakeAuthority(input: {
  authority: SourceIntakeAuthority;
  tenantId: string;
  actorUserId: string;
}): void {
  if (isMintedDocumentUploadAuthority(input.authority, input)) return;
  if (isMintedSourceDelegationAuthority(input.authority)) {
    const authority = input.authority;
    const policy = parseSourceDelegationPolicy(process.env.WISELINK_SOURCE_INTAKE_POLICIES_JSON)
      .find(item => item.tenantId === input.tenantId &&
        item.sourceKey === authority.policy.sourceKey);
    if (policy?.enabled && authority.policy.tenantId === input.tenantId &&
      authority.policy.responsibilityActorUserId === input.actorUserId &&
      JSON.stringify(policy) === JSON.stringify(authority.policy)) return;
  }
  throw new Error('SOURCE_INTAKE_AUTHORITY_REQUIRED');
}

export function validDelivery(value: unknown): value is DocumentDeliverySelection {
  return isRecord(value) && exactKeys(value, ['reading', 'translation']) &&
    typeof value.reading === 'boolean' &&
    (value.translation === 'NONE' || value.translation === 'ZH_FULL');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function isText(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

function exactKeys(value: Record<string, unknown>, keys: string[]): boolean {
  return Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
}
