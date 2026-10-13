// Exact observed self-reports and source diagnostics already retained in the
// original comparison details. Keep engineering conditions, specific unread
// material and any entry with additional facts intact.
const historicalReadingBoilerplate = new Set([
  '本结果仅为文件解读候选，不构成机队适用性判断、工程决定、批准、执行或发布；未采用任何事项特定假设，未生成sourceBinding、readCoverage、revision或producer信息。',
  'sourceCoverage.unresolvedRanges非空：第1、2、3、5、6页（0基索引0、1、2、4、5）多个单元被标记TEXT_CONFLICT，包括次型号清单、适用范围段、参考文件表、附件II MEDB表格多个单元格及注释等，其结构化内容与PDF文本层未确切对应；本解读基于Host已交付的结构化单元，相关字符级细节（尤其MEDB表格单元格内容与注释）使用前应核对原页。',
  '全部6页的结构化单元均已交付读取，但不代表原始PDF所有视觉内容（如表格图像细节）均已核实。',
].map(value => value.replace(/\s+/gu, '')));

export function documentReadingLimitations(values: readonly string[]): string[] {
  return values.filter(value => !historicalReadingBoilerplate.has(value.replace(/\s+/gu, '')));
}
