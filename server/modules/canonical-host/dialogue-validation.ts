import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';

export function dialogueId(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(
      value,
    )
  )
    throw new BadRequestException('DIALOGUE_ID_INVALID');
  return value.toLowerCase();
}
export function dialogueText(
  value: unknown,
  max: number,
  code = 'DIALOGUE_INPUT_INVALID',
): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max)
    throw new BadRequestException(code);
  return value;
}
export function dialogueRevision(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1)
    throw new BadRequestException('DIALOGUE_REVISION_INVALID');
  return Number(value);
}
export function dialogueObject(
  value: unknown,
  keys: string[],
): Record<string, unknown> {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).some((key) => !keys.includes(key))
  )
    throw new BadRequestException('DIALOGUE_INPUT_INVALID');
  return value as Record<string, unknown>;
}
export function dialogueWorkItemIds(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > 8)
    throw new BadRequestException('DIALOGUE_FOCUS_INVALID');
  const ids = value.map((item) =>
    dialogueText(item, 96, 'DIALOGUE_FOCUS_INVALID'),
  );
  if (new Set(ids).size !== ids.length)
    throw new BadRequestException('DIALOGUE_FOCUS_INVALID');
  return ids;
}
export function dialogueConflict(code = 'DIALOGUE_REVISION_CHANGED'): never {
  throw new ConflictException(code);
}
export function dialogueNotFound(): never {
  throw new NotFoundException('DIALOGUE_NOT_FOUND');
}
