import type { Request } from 'express';
import type { TdmsNativeReceiverBinding } from '@shared/tdms-receiver.interface';
import { object, strict } from './tdms-source.validation';
import { tdmsError } from './tdms-source.types';

const keys = [
  'schemaVersion',
  'receiverId',
  'tenantRef',
  'applicationRef',
  'principalRef',
  'sourceSystem',
  'sourceInstanceRef',
  'authorityRevision',
  'authorityEvidenceRef',
  'sessionEvidenceRef',
  'observedAt',
];
export const TDMS_EXPECTED_RECEIVER_HEADER =
  'x-wiselink-tdms-expected-receiver';

/** A conditional identity pin only. It supplies no Source grant, actor or session. */
export function expectedTdmsReceiver(
  request: Request,
): TdmsNativeReceiverBinding | null {
  const header = request.headers?.[TDMS_EXPECTED_RECEIVER_HEADER];
  if (header === undefined) return null;
  try {
    if (
      typeof header !== 'string' ||
      header.length > 8192 ||
      !/^[A-Za-z0-9_-]+$/u.test(header)
    )
      throw new Error();
    const bytes = Buffer.from(header, 'base64url');
    if (bytes.toString('base64url') !== header) throw new Error();
    const value = object(JSON.parse(bytes.toString('utf8')));
    strict(value, keys);
    if (
      Object.keys(value).length !== keys.length ||
      keys.some(
        (k) =>
          typeof value[k] !== 'string' ||
          !(value[k] as string).length ||
          (value[k] as string).length > 512 ||
          /[\u0000-\u001f\u007f]/u.test(value[k] as string),
      ) ||
      value.schemaVersion !== 'wiselink.tdms-native-host-receiver-binding.v1' ||
      value.sourceSystem !== 'TDMS' ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/u.test(
        value.observedAt as string,
      ) ||
      !Number.isFinite(Date.parse(value.observedAt as string))
    )
      throw new Error();
    return value as unknown as TdmsNativeReceiverBinding;
  } catch {
    throw tdmsError('TDMS_RECEIVER_EXPECTATION_INVALID', 409);
  }
}

export function assertExpectedTdmsReceiver(
  expected: TdmsNativeReceiverBinding,
  actual: TdmsNativeReceiverBinding,
): void {
  if (
    keys.some(
      (k) =>
        k !== 'observedAt' &&
        expected[k as keyof TdmsNativeReceiverBinding] !==
          actual[k as keyof TdmsNativeReceiverBinding],
    )
  )
    throw tdmsError('TDMS_RECEIVER_IDENTITY_CHANGED', 409);
}
