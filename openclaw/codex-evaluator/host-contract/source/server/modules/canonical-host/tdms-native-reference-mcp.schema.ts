import { z } from 'zod/v4';
import {
  isTdmsApprovedOpinionReference,
  TDMS_APPROVED_OPINION_REFERENCE_MAX_LENGTH,
  TDMS_APPROVED_OPINION_REFERENCE_PATTERN,
  TDMS_ORDINARY_REFERENCE_PATTERN,
} from '@shared/tdms-approved-opinion-reference';

/** Narrow native exception at the actual MCP ingress. The supplied ordinary
 * reference schema retains its prior cap/whitespace rules; malformed native
 * namespace references cannot fall back through that branch. */
export function tdmsNativeReferenceMcpSchema(ordinary: z.ZodString) {
  return z.union([
    ordinary.regex(new RegExp(TDMS_ORDINARY_REFERENCE_PATTERN, 'u')),
    z
      .string()
      .min(1)
      .max(TDMS_APPROVED_OPINION_REFERENCE_MAX_LENGTH)
      .regex(new RegExp(TDMS_APPROVED_OPINION_REFERENCE_PATTERN, 'u'))
      .refine(isTdmsApprovedOpinionReference),
  ]);
}
