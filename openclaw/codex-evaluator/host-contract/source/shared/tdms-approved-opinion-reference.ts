/** Generated opinion locators combine five independent atomic identifiers. The
 * 255-code-unit atomic limit must not be applied to the percent-encoded tuple.
 * A BMP code unit can expand to nine URI characters; safe integer indexes add
 * at most sixteen decimal digits. No reference is shortened or hashed. */
export const TDMS_APPROVED_OPINION_REFERENCE_PREFIX = 'TDMS_APPROVED_OPINION:';
export const TDMS_APPROVED_OPINION_REFERENCE_MAX_LENGTH =
  TDMS_APPROVED_OPINION_REFERENCE_PREFIX.length + 5 * 255 * 9 + 5 + 16;

/** JSON Schema advertises the native-only extension; the runtime predicate also
 * checks decoded atomic limits and canonical encoding that regex cannot express. */
export const TDMS_APPROVED_OPINION_REFERENCE_PATTERN =
  "^TDMS_APPROVED_OPINION:(?:[A-Za-z0-9_.!~*'()-]|%[0-9A-F]{2})+(?::(?:[A-Za-z0-9_.!~*'()-]|%[0-9A-F]{2})+){4}:(?:0|[1-9]\\d{0,15})$";
export const TDMS_ORDINARY_REFERENCE_PATTERN = '^(?!TDMS_APPROVED_OPINION:)';

/** Accept exactly the canonical wire spelling emitted by tdmsApprovedOpinionRef.
 * This validates a locator only; its binding and current authority remain the
 * caller's responsibility. Atomic identifier limits are unchanged. */
export function isTdmsApprovedOpinionReference(
  value: unknown,
): value is string {
  if (
    typeof value !== 'string' ||
    !value.startsWith(TDMS_APPROVED_OPINION_REFERENCE_PREFIX) ||
    value.length > TDMS_APPROVED_OPINION_REFERENCE_MAX_LENGTH
  )
    return false;
  const components = value
    .slice(TDMS_APPROVED_OPINION_REFERENCE_PREFIX.length)
    .split(':');
  if (components.length !== 6) return false;
  const index = components[5]!;
  if (
    !/^(?:0|[1-9]\d{0,15})$/u.test(index) ||
    !Number.isSafeInteger(Number(index))
  )
    return false;
  try {
    return components.slice(0, 5).every((component) => {
      const atomic = decodeURIComponent(component);
      return (
        atomic.length > 0 &&
        atomic.length <= 255 &&
        atomic.trim() === atomic &&
        !/[\u0000-\u001f\u007f]/u.test(atomic) &&
        encodeURIComponent(atomic) === component
      );
    });
  } catch {
    return false;
  }
}
