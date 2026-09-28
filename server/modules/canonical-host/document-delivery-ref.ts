import { createHash } from 'node:crypto';

const DELIVERY_REF = /^(?:work-item:WI(?:-[A-Za-z0-9_-]{1,93})?|acquisition:[A-Za-z0-9_-]{1,96})$/u;

/** A selector, never an authorization by itself. Host re-reads its saved owner. */
export function documentDeliveryRequestId(
  kind: 'reading' | 'translation', deliveryRef: string,
): string {
  if (!DELIVERY_REF.test(deliveryRef)) throw new Error('DOCUMENT_DELIVERY_REF_INVALID');
  return `auto-${kind}-${createHash('sha256').update(deliveryRef).digest('hex').slice(0, 32)}`;
}
