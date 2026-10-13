// Exact historical model self-report observed in a saved reading. Keep source
// coverage, engineering conditions and any entry with additional facts intact.
const historicalReadingBoilerplate = new Set([
  '本结果仅为文件解读候选，不构成机队适用性判断、工程决定、批准、执行或发布；未采用任何事项特定假设，未生成sourceBinding、readCoverage、revision或producer信息。',
].map(value => value.replace(/\s+/gu, '')));

export function documentReadingLimitations(values: readonly string[]): string[] {
  return values.filter(value => !historicalReadingBoilerplate.has(value.replace(/\s+/gu, '')));
}
