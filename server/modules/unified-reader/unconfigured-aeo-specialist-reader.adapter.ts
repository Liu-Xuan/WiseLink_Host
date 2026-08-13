import type {
  AeoSpecialistReaderInspection,
  AeoSpecialistReaderPort,
} from './unified-reader.types';

export class UnconfiguredAeoSpecialistReaderAdapter
  implements AeoSpecialistReaderPort
{
  async inspectActualBytes(): Promise<AeoSpecialistReaderInspection> {
    throw new Error(
      'CANONICAL_ROLE_NOT_VERIFIED:AEO_SPECIALIST_READER_UNCONFIGURED',
    );
  }
}
