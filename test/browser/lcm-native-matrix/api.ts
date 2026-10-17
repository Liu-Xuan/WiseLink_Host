import type { LcmNativeMatrixResponse } from '../../../shared/lcm-native-matrix.interface';
import type { LcmMatrixBinding, LcmMatrixDetailRequest, LcmMatrixDetailResponse } from '../../../shared/lcm-matrix.interface';
import type { LcmSnapshotCatalogueResponse } from '../../../shared/lcm-source-reading.interface';
import type { LcmPersonalLibraryResponse } from '../../../shared/lcm-personal-import.interface';

async function read<T>(path: string, input: unknown, signal?: AbortSignal): Promise<T> {
  const response: Response = await fetch('/fixture-api/' + path, { method: 'POST', signal,
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) });
  if (!response.ok) throw Object.assign(new Error('LOCAL_TEST_READ_FAILED'), { statusCode: response.status });
  return response.json() as Promise<T>;
}
export const readLcmNativeMatrix = (input: { snapshotIds: string[] }, signal?: AbortSignal) =>
  read<LcmNativeMatrixResponse>('native', input, signal);
export const authorizeLcmNativeMatrix = (input: { snapshotIds: string[]; binding: LcmMatrixBinding }, signal?: AbortSignal) =>
  read<{ binding: LcmMatrixBinding }>('authorize', input, signal);
export const readLcmNativeMatrixDetails = (input: LcmMatrixDetailRequest, signal?: AbortSignal) =>
  read<LcmMatrixDetailResponse>('details', input, signal);
export const readLcmSourceSnapshots = (input: unknown, signal?: AbortSignal) =>
  read<LcmSnapshotCatalogueResponse>('snapshots', input, signal);
export const readLcmPersonalLibrary = (signal?: AbortSignal) => read<LcmPersonalLibraryResponse>('personal', {}, signal);
export const getCanonicalHostClientSessionGeneration = () => 1;
export const importLcmExcel = async () => { throw new Error('LOCAL_UI_FIXTURE_NO_IMPORT'); };
export const resolveLcmExcelUpload = async () => { throw new Error('LOCAL_UI_FIXTURE_NO_UPLOAD'); };
export const uploadFile = async () => { throw new Error('LOCAL_UI_FIXTURE_NO_UPLOAD'); };
export const downloadLcmOriginal = async () => new Blob(['LOCAL UI TEST ONLY']);
