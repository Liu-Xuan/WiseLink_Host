import type { DocumentExtractedMetadata } from '@shared/api.interface';
import type { ParsedPdfLayout } from '../../../../professional-input/pure/professional-input-pure.types';
export function extractActualPdfMetadata(input: {
  layout: ParsedPdfLayout;
  actualSha256: string;
  actualByteLength: number;
  identity: { documentFamily: string; issuer: string };
  extractedAt?: string;
}): DocumentExtractedMetadata;
