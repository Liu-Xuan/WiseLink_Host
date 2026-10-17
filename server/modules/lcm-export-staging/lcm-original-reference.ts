export interface LcmOriginalReference {
  kind: 'LCM_HOST_ORIGINAL';
  bucketId: string;
  filePath: string;
  providerObjectId: string;
  originalFileName: string;
}

export function lcmOriginalReference(value: string): LcmOriginalReference | null {
  if (!value.startsWith('{')) return null;
  let input: unknown;
  try { input = JSON.parse(value); } catch { return null; }
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const row: Record<string, unknown> = input as Record<string, unknown>;
  if (row.kind !== 'LCM_HOST_ORIGINAL' || ['bucketId', 'filePath', 'providerObjectId', 'originalFileName']
    .some((key: string) => typeof row[key] !== 'string' || !String(row[key]).trim())) return null;
  return { kind: 'LCM_HOST_ORIGINAL', bucketId: String(row.bucketId), filePath: String(row.filePath),
    providerObjectId: String(row.providerObjectId), originalFileName: String(row.originalFileName) };
}
