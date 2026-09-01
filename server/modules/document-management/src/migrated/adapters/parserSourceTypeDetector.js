import path from 'path';

function normalizeString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function firstNonEmptyString(...values) {
  for (const value of values) {
    const normalized = normalizeString(value);
    if (normalized) return normalized;
  }
  return '';
}

function sanitizeText(value) {
  return String(value || '').replace(/\r\n/g, '\n').trim();
}

function hasBoeingFtdFilenameIdentity(text = '') {
  return /(?:^|[^a-z0-9])(?:737max|737ng|737|747|767|777|787)-ftd-\d{2}-\d{5}(?:[^a-z0-9]|$)/i.test(text)
    || /fleet[-_\s]*team[-_\s]*digest/i.test(text);
}

function hasBoeingFtdDocumentIdentity(text = '') {
  return /\bfleet\s+team\s+digest\s+(?:(?:737max|737ng|737|747|767|777|787)-ftd-\d{2}-\d{5}|issue\s+title\s*:)/i.test(text)
    || /\b(?:737max|737ng|737|747|767|777|787)-ftd-\d{2}-\d{5}\s+fleet\s+team\s+digest\b/i.test(text)
    || /\bftd\s+number\s*:/i.test(text);
}

function hasBoeingMpdFilenameIdentity(text = '') {
  return /\b(?:b?737|max|b?747|b?767|b?777|b?787)[a-z0-9/_\s-]{0,80}\bmpd\b/i.test(text)
    || /\bmaintenance[-_\s]*planning[-_\s]*document\b/i.test(text);
}

function hasBoeingMpdDocumentIdentity(text = '') {
  const hasBoeingContext = /\bBOEING\b|\b(?:737|747|767|777|787)\b/i.test(text);
  return hasBoeingContext && ((
    /\bmaintenance\s+planning\s+document\b/i.test(text)
    && /\bdocument\s+D[0-9A-Z]{5,}\b/i.test(text)
  ) || /\b(?:737|747|767|777|787)[-0-9A-Z/\s]{0,80}\n\s*maintenance\s+planning\s+document\b/i.test(text));
}

function hasBoeingMaintenanceTipFilenameIdentity(text = '') {
  return /\b(?:737max|737|747|757|767|777|787)\s*[-_\s]*mt\s*[-_\s]*\d{2}[-_\s]*\d{3}(?:[-_\s]*r\d+)?\b/i.test(text)
    || /\bmaintenance[-_\s]*tip\b/i.test(text);
}

function hasBoeingMaintenanceTipDocumentIdentity(text = '') {
  return /\bmaintenance\s+tip\b[\s\S]{0,260}\b(?:737max|737|747|757|767|777|787)\s+mt\s+\d{2}-\d{3}(?:\s*-?\s*r\d+)?\b/i.test(text)
    || /\b(?:737max|737|747|757|767|777|787)\s+mt\s+\d{2}-\d{3}(?:\s*-?\s*r\d+)?\b[\s\S]{0,260}\bmaintenance\s+tip\b/i.test(text);
}

function hasDirectiveDocumentIdentity(text = '') {
  return /\b(?:FAA|EASA)?\s*AD\s+No\.?\s*[:：]?\s*\d{4}-\d{4}R?\d*\b/i.test(text)
    || /\bAD\s+\d{4}-\d{2}-\d{2}\b/i.test(text)
    || /\bCAD\s*\d{4}[-_\s]?[A-Z0-9]+[-_\s]?\d+(?:R\d+)?\b/i.test(text)
    || /适\s*航\s*指\s*令|AIRWORTHINESS\s+DIRECTIVE/i.test(text);
}

export function hasServiceLetterDocumentIdentity(text = '') {
  const head = String(text || '').slice(0, 4000);
  return /service letter|service\s+letter|(?:^|[^a-z0-9])(?:737|747|767|777|787)[-_\s]*sl[-_\s]*\d/i.test(head);
}

function hasHoneywellServiceInformationLetterIdentity(text = '') {
  const head = String(text || '').slice(0, 4000);
  return (
    /\bHONEYWELL(?:\s+INTERNATIONAL\s+INC\.)?\b/i.test(head) &&
    /\bSERVICE\s+INFORMATION\s+LETTER\b/i.test(head) &&
    /\bPUBLICATION\s+NUMBER\s+D\d{12}\b/i.test(head)
  );
}

function hasServiceBulletinDocumentIdentity(text = '') {
  return /service\s+bulletin|\bsb\s+\d{3}-\d{2}-\d{4}|\bsb[-_\s]*\d/i.test(text);
}

export function hasDirectiveCurrentSourceIdentity(text = '') {
  const source = String(text || '').replace(/[\u2010-\u2015]/g, '-');
  return (
    /\bDEPARTMENT\s+OF\s+TRANSPORTATION\b[\s\S]{0,700}\b14\s+CFR\s+Part\s+39\b[\s\S]{0,700}\bAD\s+\d{4}-\d{2}-\d{2}\b/i.test(source)
    || /\[\s*Docket\s+No\.[^\]]*;\s*AD\s+\d{4}-\d{2}-\d{2}\s*\]/i.test(source)
    || /^\s*\d{4}-\d{2}-\d{2}\s+[A-Z][A-Za-z0-9&.,() /-]+:\s+Amendment\s+39-\d+/im.test(source)
    || /\bEASA\s+AD\s+No\.?\s*[:：]?\s*\d{4}-\d{4}R?\d*\b[\s\S]{0,260}\bAirworthiness\s+Directive\b/i.test(source)
    || /\bEmergency\s+Airworthiness\s+Directive\b[\s\S]{0,260}\bAD\s+No\.?\s*[:：]?\s*\d{4}-\d{4}R?\d*\b/i.test(source)
    || /中国民用航空局[\s\S]{0,260}适\s*航\s*指\s*令[\s\S]{0,260}编号[:：]\s*CAD\s*\d{4}[-_\s]?[A-Z0-9]+[-_\s]?\d+(?:R\d+)?/i.test(source)
  );
}

export function hasDirectiveAuxiliarySourceIdentity(text = '') {
  return /Evaluation\s+Attachment|相关\s*AD\s*评估|评估附件|评估单|AD\/CAD\s+Processing\s+Sheet|适航指令处理单/i.test(text)
    || /Airworthiness\s+Directive\s+Status\s+Letter|Status\s+of\s+FAA\s+Airworthiness\s+Directive\s+for\s+Airplane/i.test(text)
    || /Alternative\s+Method\s+of\s+Compliance(?:\s+\(AMOC\))?\s*(?:Notice\s+Number|[-–—]\s*Approval)|FAA\s+AMOC\s+\d|AMOC\s+Letter\s+\d/i.test(text)
    || /Engineering\s+Order|工程指令|EO\s*(?:编号|No\.?|NO\.)\s*[:：]?\s*EO-/i.test(text)
    || /HANA\s+EIU\s+LIST|EIU组件|序号核查|发件人:|收件人:|主题:|答复:/i.test(text);
}

function hasAirbusServiceBulletinIdentity(text = '') {
  return (
    /\bSERVICE\s+BULLETIN\b/i.test(text)
    && /\bATA\s+SYSTEM\s*:\s*\d{2}\b/i.test(text)
    && /\bA(?:318|319|320|321|330|340|350|380)-\d{2}-[A-Z0-9]{3,5}\b/i.test(text)
  );
}

function airbusOperatorTransmissionCategory(text = '') {
  if (/\bSERVICE\s+BULLETIN\s+INFORMATION\s+TRANSMISSION\b|\bOIT\s+CATEGORY\s*:\s*SERVICE\s+BULLETIN\s+INFORMATION\s+TRANSMISSION\b|\bSBIT[-\s]?\d/i.test(text)) return 'airbus_sbit';
  if (/\bALERT\s+OPERATORS\s+TRANSMISSION\s*-\s*AOT\b|\bAOT\s+ref\s*:/i.test(text)) return 'airbus_aot';
  if (/\bOPERATORS\s+INFORMATION\s+TRANSMISSION\s*-\s*OIT\b|\bOIT\s+ref\s*:/i.test(text)) return 'airbus_oit';
  if (/\bFLIGHT\s+OPERATIONS\s+TRANSMISSION\s*-\s*FOT\b|\bFOT\s+ref\s*:/i.test(text)) return 'airbus_fot';
  return '';
}

function hasAirbusOperatorTransmissionIdentity(text = '') {
  return Boolean(airbusOperatorTransmissionCategory(text));
}

function hasAirbusRetrofitInformationLetterIdentity(text = '') {
  return /\bRETROFIT\s+INFORMATION\s+LETTER\s*-\s*RIL\b|\bRIL\s+Reference\s*:/i.test(text);
}

function airbusMaintenanceProgrammeCategory(text = '') {
  if (/\bETOPS\s+CMP\s+Document\b|\bConfiguration,\s*Maintenance,\s*Procedure\s+and\s+Dispatch\b/i.test(text)) return 'airbus_cmp';
  if (/\bAIRWORTHINESS\s+LIMITATIONS\s+SECTION\b|\bALS\s+Part\s+\d\b|\bALS\s+PART\s+\d\b/i.test(text)) return 'airbus_als';
  return '';
}

function hasAirbusMaintenanceProgrammeIdentity(text = '') {
  return Boolean(airbusMaintenanceProgrammeCategory(text));
}

function airbusSupportDocumentCategory(text = '') {
  if (/\bReference:\s*\d{2}\.\d{2}\.\d{5}\b|\bEngineering\s+Support\b[\s\S]{0,80}\bStatus:\s*Open\b/i.test(text)) return 'airbus_tfu';
  if (/\bCONCESSION\b[\s\S]{0,200}\bDescription\s+of\s+Divergence\b|\bResponsible\s+Design\s+Office\s+Decision\b/i.test(text)) return 'airbus_concession';
  if (/^\s*改版记录\s*\n\s*REVISION\s+RECORD\b|^\s*REVISION\s+RECORD\b/im.test(text)) return 'airbus_ame';
  return '';
}

function hasAirbusSupportDocumentIdentity(text = '') {
  return Boolean(airbusSupportDocumentCategory(text));
}

function stringifySearchable(value, depth = 0) {
  if (value === null || value === undefined || depth > 3) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return value.map((entry) => stringifySearchable(entry, depth + 1)).filter(Boolean).join('\n');
  if (typeof value === 'object') {
    return Object.entries(value)
      .filter(([key]) => !/^(raw|base64|bytes|buffer)$/i.test(key))
      .map(([key, entry]) => `${key}: ${stringifySearchable(entry, depth + 1)}`)
      .filter(Boolean)
      .join('\n');
  }
  return '';
}

function resolveFileExtension(input = {}) {
  const explicit = firstNonEmptyString(
    input.fileExtension,
    input.extension,
    input.metadata?.fileExtension,
    input.metadata?.extension,
    input.parserOutput?.fileExtension,
    input.parserOutput?.extension,
  ).toLowerCase();
  if (explicit) return explicit.startsWith('.') ? explicit : `.${explicit}`;
  const sourceName = firstNonEmptyString(
    input.filename,
    input.fileName,
    input.file_name,
    input.filePath,
    input.metadata?.filename,
    input.metadata?.fileName,
    input.metadata?.file_name,
    input.parserOutput?.filename,
    input.parserOutput?.fileName,
    input.parserOutput?.file_name,
    input.parserOutput?.filePath,
  );
  return path.extname(sourceName).toLowerCase();
}

function resolveSearchableText(input = {}) {
  return [
    input.filename,
    input.fileName,
    input.file_name,
    input.filePath,
    input.content,
    input.text,
    input.markdown,
    stringifySearchable(input.normalizedBlocks),
    stringifySearchable(input.blocks),
    input.metadata?.filename,
    input.metadata?.fileName,
    input.metadata?.file_name,
    input.metadata?.source_type,
    input.metadata?.sourceType,
    stringifySearchable(input.parserOutput),
    stringifySearchable(input.structuredParse),
    stringifySearchable(input.structuredDoc),
  ].map(sanitizeText).filter(Boolean).join('\n');
}

export function inferSourceType({
  filename,
  fileName,
  file_name,
  filePath,
  content,
  parserOutput,
  metadata = {},
  normalizedBlocks,
  blocks,
} = {}) {
  const explicit = firstNonEmptyString(
    metadata.source_type,
    metadata.sourceType,
    parserOutput?.source_type,
    parserOutput?.sourceType,
  ).toLowerCase();
  if (explicit) return explicit;

  const sourceName = firstNonEmptyString(
    filename,
    fileName,
    file_name,
    filePath,
    metadata?.filename,
    metadata?.fileName,
    metadata?.file_name,
    parserOutput?.filename,
    parserOutput?.fileName,
    parserOutput?.file_name,
    parserOutput?.originalFilename,
  ).toLowerCase();
  const contentText = [
    sanitizeText(content),
    stringifySearchable(normalizedBlocks),
    stringifySearchable(blocks),
    JSON.stringify(parserOutput || {}),
  ].filter(Boolean).join('\n').toLowerCase();
  const text = `${sourceName}\n${contentText}`;
  if (
    hasBoeingFtdFilenameIdentity(sourceName)
    || hasBoeingFtdDocumentIdentity(contentText)
  ) return 'boeing_ftd';
  if (hasDirectiveCurrentSourceIdentity(text)) return 'ad';
  if (hasHoneywellServiceInformationLetterIdentity(text)) return 'supplier_sil';
  if (hasServiceLetterDocumentIdentity(text)) return 'boeing_service_letter';
  if (hasDirectiveAuxiliarySourceIdentity(text)) return 'generic';
  if (hasAirbusRetrofitInformationLetterIdentity(text)) return 'airbus_retrofit_information_letter';
  if (hasAirbusServiceBulletinIdentity(text)) return 'airbus_service_bulletin';
  if (hasAirbusOperatorTransmissionIdentity(text)) return 'airbus_operator_transmission';
  if (hasAirbusMaintenanceProgrammeIdentity(text)) return 'airbus_maintenance_programme';
  if (hasAirbusSupportDocumentIdentity(text)) return 'airbus_support_document';
  if (hasServiceBulletinDocumentIdentity(text)) return 'boeing_service_bulletin';
  if (
    hasBoeingMpdFilenameIdentity(sourceName)
    || hasBoeingMpdDocumentIdentity(contentText)
  ) return 'boeing_mpd';
  if (
    hasBoeingMaintenanceTipFilenameIdentity(sourceName)
    || hasBoeingMaintenanceTipDocumentIdentity(contentText)
  ) return 'boeing_maintenance_tip';
  if (/s1000d|dmodule|dmcode|appliccrossreftable|pmentry|dmref/.test(text)) return 's1000d';
  if (/airbus/.test(text)) return 'airbus';
  if (/boeing|fleet team digest|ftd/.test(text)) return 'boeing';
  const ext = path.extname(sourceName).toLowerCase();
  if (ext === '.xml') return 's1000d';
  return 'generic';
}

export function detectDocumentDimensions(input = {}) {
  const text = resolveSearchableText(input).toLowerCase();
  const ext = resolveFileExtension(input);
  const sourceName = firstNonEmptyString(
    input.filename,
    input.fileName,
    input.file_name,
    input.filePath,
    input.metadata?.filename,
    input.metadata?.fileName,
    input.metadata?.file_name,
    input.parserOutput?.filename,
    input.parserOutput?.fileName,
    input.parserOutput?.file_name,
    input.parserOutput?.originalFilename,
  ).toLowerCase();
  const explicitParserFormat = firstNonEmptyString(
    input.parserFormat,
    input.parser_format,
    input.metadata?.parserFormat,
    input.metadata?.parser_format,
    input.parserOutput?.parserFormat,
    input.parserOutput?.parser_format,
  ).toLowerCase();
  const explicitDocumentCategory = firstNonEmptyString(
    input.documentCategory,
    input.document_category,
    input.metadata?.documentCategory,
    input.metadata?.document_category,
    input.parserOutput?.documentCategory,
    input.parserOutput?.document_category,
  ).toLowerCase();

  let parserFormat = 'pdf';
  if (['s1000d_xml', 'pdf', 'word'].includes(explicitParserFormat)) {
    parserFormat = explicitParserFormat;
  } else if (ext === '.xml' || /s1000d|dmodule|dmcode|appliccrossreftable|pmentry|dmref/.test(text)) {
    parserFormat = 's1000d_xml';
  } else if (ext === '.docx' || ext === '.doc') {
    parserFormat = 'word';
  }

  let documentCategory = 'generic';
  if (['boeing_ftd', 'boeing_mpd', 'boeing_maintenance_tip', 'maintenance_tip', 'mpd', 'sb', 'sl', 'rb', 'sil', 'ad', 'amm', 'mt', 'airbus_sb', 'airbus_sbit', 'airbus_aot', 'airbus_oit', 'airbus_fot', 'airbus_ril', 'airbus_als', 'airbus_cmp', 'airbus_tfu', 'airbus_concession', 'airbus_ame', 'generic'].includes(explicitDocumentCategory)) {
    documentCategory = explicitDocumentCategory;
  } else if (hasBoeingFtdFilenameIdentity(sourceName) || hasBoeingFtdDocumentIdentity(text)) {
    documentCategory = 'boeing_ftd';
  } else if (hasDirectiveCurrentSourceIdentity(text)) {
    documentCategory = 'ad';
  } else if (hasHoneywellServiceInformationLetterIdentity(text)) {
    documentCategory = 'sil';
  } else if (hasServiceLetterDocumentIdentity(text)) {
    documentCategory = 'sl';
  } else if (hasDirectiveAuxiliarySourceIdentity(text)) {
    documentCategory = 'generic';
  } else if (hasAirbusRetrofitInformationLetterIdentity(text)) {
    documentCategory = 'airbus_ril';
  } else if (hasAirbusServiceBulletinIdentity(text)) {
    documentCategory = 'airbus_sb';
  } else if (hasAirbusOperatorTransmissionIdentity(text)) {
    documentCategory = airbusOperatorTransmissionCategory(text);
  } else if (hasAirbusMaintenanceProgrammeIdentity(text)) {
    documentCategory = airbusMaintenanceProgrammeCategory(text);
  } else if (hasAirbusSupportDocumentIdentity(text)) {
    documentCategory = airbusSupportDocumentCategory(text);
  } else if (hasBoeingMpdFilenameIdentity(sourceName) || hasBoeingMpdDocumentIdentity(text)) {
    documentCategory = 'mt';
  } else if (hasBoeingMaintenanceTipFilenameIdentity(sourceName) || hasBoeingMaintenanceTipDocumentIdentity(text)) {
    documentCategory = 'mt';
  } else if (hasServiceBulletinDocumentIdentity(text)) {
    documentCategory = 'sb';
  } else if (hasDirectiveDocumentIdentity(`${sourceName}\n${text}`)) {
    documentCategory = 'ad';
  } else if (/requirements? bulletin|required for compliance/.test(text)) {
    documentCategory = 'rb';
  } else if (/service information letter|(?:^|[^a-z0-9])sil[-_\s]*[a-z0-9]/.test(text)) {
    documentCategory = 'sil';
  } else if (/airworthiness directive|\bad\s+\d{4}-\d{2}-\d{2}|\bad[-_\s]*\d{4}[-_\s]*\d+/.test(text)) {
    documentCategory = 'ad';
  } else if (/airbus.*\btfu\b|\btfu\b.*airbus/.test(text)) {
    documentCategory = 'airbus_tfu';
  } else if (/aircraft maintenance manual|\bamm\b|pmentry|dmref|dmodule/.test(text)) {
    documentCategory = 'amm';
  }

  return { parserFormat, documentCategory };
}
