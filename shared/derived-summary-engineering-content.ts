/** Stable text identity only. Different citations, editions and conditions stay distinct. */
export function deduplicateSummaryNotices(values: readonly string[]): string[] {
  const seen = new Set<string>();
  return values.filter((value: string) => {
    const key = value.normalize('NFC').replace(/\s+/gu, ' ').trim();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

const internalSummaryNotices = new Set([
  '仅覆盖显式选取的精确保存成员；未选成员、其他ATA和其他机型均未覆盖。',
  '机型/ATA为用户选取的候选分类，成员归属和适用性未核。不是受控事实、批准或正式采用。',
  '独立文件解读为派生候选，不是事项评估、适用性结论或正式采用。',
  '本成员为已保存候选工作；同一根来源在其他成员中出现时只计一次，不继承其正式采用、适用性或执行状态。',
  '这是派生候选摘要，不是新增独立证据。仅覆盖已保存的精确成员。',
  'NATIVE_CURRENTNESS_NOT_CONNECTED',
].map((value: string) => value.replace(/\s+/gu, '')));

function internalSummaryNotice(value: string): boolean {
  const compact = value.replace(/\s+/gu, '');
  return internalSummaryNotices.has(compact) ||
    /^来源版本[A-Za-z0-9_-]+[是为]本地目录当前选择[；，]发布方现行有效状态未核，不代表适用性、正式采用或其他版本覆盖。?$/u.test(compact) ||
    /^原件交付范围[：:]COMPLETE_DELIVERY[，,]\d+\/\d+。?$/u.test(compact) ||
    /^成员概述状态为(?:STALE|NOT_AVAILABLE)，不能视为现行完整概述。?$/u.test(compact) ||
    /^本次尚未完成的下层依赖[：:]SUMMARY仍为PARTIAL，DOCUMENT仍为SAVED_ASSESSMENT_NOT_READY。?$/u.test(compact);
}

function internalSummaryClause(value: string): boolean {
  const compact = value.replace(/\s+/gu, '');
  return /^(?:本候选|本次为文件解读，)不形成机队适用性、工程决策、批准、执行或正式采用意见[；;。]?$/u.test(compact) ||
    /^(?:fleet_configuration|reliability_history|knowledge_retrieval)(?:[、,/](?:fleet_configuration|reliability_history|knowledge_retrieval))*capability均NOT_CONNECTED\/ACCESS_DENIED[；;。]?$/u.test(compact);
}

/** Only the known layer introduction grammar. A qualifier inside either scope
 * makes the match fail, so an engineering condition can never be swallowed. */
function withoutLayerIntroduction(value: string, processingRecords?: string[]): string {
  const recordIntroduction = (text: string): string => { processingRecords?.push(text.trim()); return ''; };
  return value
    .replace(/^本层为\s*[A-Za-z0-9_-]+\s*(?:[·•/]\s*)?ATA\s*\d{2}(?:-\d{2})?\s*(?:[（(](?:ATA2|ATA4)[）)])?\s*候选综合，由其唯一已保存的\s*ATA\s*\d{2}(?:-\d{2})?\s*子层候选正文\s*(?:\[\[[^\[\]\r\n]+\]\]\s*)?形成，保留该子层身份及其全部继承限制(?:[；;]\s*本层为派生候选，非新增独立证据)?(?:[。.]|$)\s*/u, recordIntroduction)
    .replace(/^以\s*ATA\s*\d{2}(?:-\d{2})?\s*子层候选为唯一来源综合[：:]\s*/u, recordIntroduction)
    .replace(/^保留该子层身份及其全部继承限制[；;]\s*本层为派生候选，非新增独立证据[。.]\s*/u, recordIntroduction)
    .replace(/^本层为派生候选，非新增独立证据[。.]\s*/u, recordIntroduction)
    .replace(/(^|[。；;]\s*)单一根来源派生，机队数据未接入，不构成机队层面结论(?=[。；;]|\s*\[\[|$)/gu,
      (text: string, prefix: string) => {
        processingRecords?.push(text.slice(prefix.length)); return `${prefix}机队数据未接入`;
      });
}

function projectEngineeringText(value: string, processingRecords?: string[]): string {
  return value.split(/\n\s*\n/gu).flatMap((paragraph: string) => {
    const text = withoutLayerIntroduction(paragraph.trim(), processingRecords);
    if (!text) return [];
    if (text === '成员已交付，但正文未直接引用；不能宣称已对该成员完成综合。')
      return ['正文未直接引用该成员工作。'];
    if (internalSummaryNotice(text)) { processingRecords?.push(text); return []; }
    // All other free-form layer/dependency text may carry engineering conditions.
    const clauses = text.match(/[^；;。]+[；;。]?/gu) ?? [];
    const kept = clauses.filter((clause: string) => {
      if (!internalSummaryClause(clause)) return true;
      processingRecords?.push(clause.trim()); return false;
    });
    // Preserve the original paragraph byte-for-byte unless an explicit control clause was removed.
    const projected = kept.length === clauses.length
      ? text === paragraph.trim() ? paragraph : text : kept.join('').trim();
    return projected.trim() ? [projected] : [];
  }).join('\n\n');
}

/** Engineer-facing projection only. Saved source text and Host control metadata are untouched. */
export function summaryEngineeringText(value: string): string {
  return projectEngineeringText(value);
}

/** The same exact projection grammars expose their removed processing prose
 * for optional reading, including any saved citations in those introductions. */
export function summaryEngineeringProcessingRecords(value: string): string[] {
  const records: string[] = [];
  projectEngineeringText(value, records);
  return deduplicateSummaryNotices(records);
}

export function summaryEngineeringLimitations(values: readonly string[]): string[] {
  return deduplicateSummaryNotices(values.flatMap((value: string) => {
    const projected = summaryEngineeringText(value).trim();
    return projected ? [projected] : [];
  }));
}

/** Remove known workflow labels, never engineering qualifiers such as “候选故障机理”. */
export function summaryEngineeringHeadline(value: string): string {
  const title = value
    .replace(/[（(]候选[，,]\s*未完成分类[）)]\s*$/u, '')
    .replace(/[—–]{1,2}(?:基于唯一\s*ATA\s*\d{2}(?:-\d{2})?\s*子层候选的上层综合|单一根来源下的文件解读与工程事项综合)\s*$/u, '')
    .replace(/候选(?=综合|汇总)/gu, '').trim();
  return title || value;
}
