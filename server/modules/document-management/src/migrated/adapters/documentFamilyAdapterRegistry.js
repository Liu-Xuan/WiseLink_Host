import fs from 'node:fs';
import path from 'node:path';

const REPO_ROOT = path.resolve(__dirname, '../../../../../..');

export const DEFAULT_DOCUMENT_FAMILY_ADAPTER_DIR = path.resolve(REPO_ROOT, 'config', 'document-family-adapters');
export const DEFAULT_DOCUMENT_FAMILY_ADAPTER_ID = 'generic.general_document.v1';
export const DOCUMENT_FAMILY_ADAPTER_SCHEMA_VERSION = 'v8.4-document-family-adapter.v1';
export const DOCUMENT_FAMILY_ADAPTER_FAMILIES = Object.freeze([
  'AD',
  'FTD',
  'GENERIC',
  'MT',
  'RB',
  'SB',
  'SIL',
  'SL',
]);

const FAMILY_SET = new Set(DOCUMENT_FAMILY_ADAPTER_FAMILIES);
const FORBIDDEN_CONCLUSION_KEYS = Object.freeze([
  'actionReady',
  'applicable',
  'claimClosed',
  'closureConclusion',
  'complianceClosed',
  'completed',
  'finalConclusion',
  'ready',
]);

let cachedRegistry = null;

function normalizeString(value = '') {
  return String(value || '').replace(/\s+/gu, ' ').trim();
}

function normalizeId(value = '') {
  return normalizeString(value)
    .toLowerCase()
    .replace(/[^a-z0-9_.-]+/gu, '.')
    .replace(/^\.+|\.+$/gu, '');
}

function normalizeToken(value = '') {
  return normalizeString(value)
    .toUpperCase()
    .replace(/[^A-Z0-9]+/gu, '_')
    .replace(/^_+|_+$/gu, '');
}

function asArray(value) {
  return Array.isArray(value) ? value.filter((entry) => entry !== undefined && entry !== null) : [];
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function deepMerge(base = {}, overlay = {}) {
  const result = clone(base);
  for (const [key, value] of Object.entries(overlay || {})) {
    if (
      value
      && typeof value === 'object'
      && !Array.isArray(value)
      && result[key]
      && typeof result[key] === 'object'
      && !Array.isArray(result[key])
    ) {
      result[key] = deepMerge(result[key], value);
    } else {
      result[key] = value;
    }
  }
  return result;
}

function readJsonFile(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    throw new Error(`Unable to parse DocumentFamilyAdapter ${filePath}: ${error.message}`);
  }
}

function collectForbiddenConclusionKeys(value = {}, pathPrefix = '') {
  const matches = [];
  if (!value || typeof value !== 'object') return matches;
  for (const [key, child] of Object.entries(value)) {
    const childPath = pathPrefix ? `${pathPrefix}.${key}` : key;
    if (FORBIDDEN_CONCLUSION_KEYS.includes(key)) matches.push(childPath);
    if (child && typeof child === 'object') {
      matches.push(...collectForbiddenConclusionKeys(child, childPath));
    }
  }
  return matches;
}

function assertRequiredString(adapter = {}, key) {
  if (!normalizeString(adapter[key])) {
    throw new Error(`DocumentFamilyAdapter ${adapter.adapterId || '<unknown>'} requires ${key}.`);
  }
}

export function normalizeDocumentFamily(value = '') {
  const normalized = normalizeToken(value);
  if (!normalized) return '';
  if (normalized === 'AIRWORTHINESS_DIRECTIVE' || normalized === 'CAD' || normalized === 'EAD') return 'AD';
  if (normalized === 'SERVICE_BULLETIN' || normalized === 'ALERT_SERVICE_BULLETIN' || normalized === 'ASB') return 'SB';
  if (normalized === 'SERVICE_LETTER') return 'SL';
  if (normalized === 'REQUIREMENTS_BULLETIN') return 'RB';
  if (normalized === 'SUPPLIER_SERVICE_INFORMATION_LETTER' || normalized === 'SUPPLIER_SIL') return 'SIL';
  if (normalized === 'FLEET_TEAM_DIGEST') return 'FTD';
  if (
    normalized === 'MAINTENANCE_TASK'
    || normalized === 'MAINTENANCE_TIP'
    || normalized === 'MAINTENANCE_PLANNING_DOCUMENT'
    || normalized === 'MPD'
  ) return 'MT';
  if (normalized === 'UNKNOWN' || normalized === 'GENERAL_DOCUMENT') return 'GENERIC';
  return FAMILY_SET.has(normalized) ? normalized : '';
}

export function validateDocumentFamilyAdapter(adapter = {}) {
  assertRequiredString(adapter, 'adapterId');
  assertRequiredString(adapter, 'docFamily');
  assertRequiredString(adapter, 'templateMode');
  assertRequiredString(adapter, 'documentTypeProfileRef');
  assertRequiredString(adapter, 'parseProfileRef');
  assertRequiredString(adapter, 'structuredParseTemplateRef');
  assertRequiredString(adapter, 'evaluationProfileRef');
  assertRequiredString(adapter, 'closurePolicyOverlayRef');

  const docFamily = normalizeDocumentFamily(adapter.docFamily);
  if (!FAMILY_SET.has(docFamily)) {
    throw new Error(`DocumentFamilyAdapter ${adapter.adapterId} has unsupported docFamily: ${adapter.docFamily}`);
  }
  if (!adapter.sourceContract || typeof adapter.sourceContract !== 'object') {
    throw new Error(`DocumentFamilyAdapter ${adapter.adapterId} requires sourceContract object.`);
  }
  if (!adapter.matchPolicy || typeof adapter.matchPolicy !== 'object') {
    throw new Error(`DocumentFamilyAdapter ${adapter.adapterId} requires matchPolicy object.`);
  }
  const forbidden = collectForbiddenConclusionKeys(adapter);
  if (forbidden.length > 0) {
    throw new Error(`DocumentFamilyAdapter ${adapter.adapterId} declares forbidden final conclusion keys: ${forbidden.join(', ')}`);
  }
  return Object.freeze({
    ...adapter,
    schemaVersion: adapter.schemaVersion || DOCUMENT_FAMILY_ADAPTER_SCHEMA_VERSION,
    adapterId: normalizeId(adapter.adapterId),
    extends: normalizeString(adapter.extends) || null,
    docFamily,
    issuerPolicy: adapter.issuerPolicy || { issuer: 'GENERIC', issuerAliases: [] },
  });
}

function resolveExtends(adapterId, rawById, resolving = new Set(), resolved = new Map()) {
  const normalizedId = normalizeId(adapterId);
  if (resolved.has(normalizedId)) return resolved.get(normalizedId);
  const raw = rawById.get(normalizedId);
  if (!raw) throw new Error(`DocumentFamilyAdapter not found: ${adapterId}`);
  if (resolving.has(normalizedId)) {
    throw new Error(`DocumentFamilyAdapter cyclic extends detected at ${adapterId}`);
  }
  resolving.add(normalizedId);
  const parentId = normalizeString(raw.extends);
  const merged = parentId
    ? deepMerge(resolveExtends(parentId, rawById, resolving, resolved), raw)
    : clone(raw);
  if (parentId && raw.matchPolicy) merged.matchPolicy = clone(raw.matchPolicy);
  if (normalizeDocumentFamily(merged.docFamily) !== 'GENERIC') delete merged.genericContract;
  resolving.delete(normalizedId);
  const validated = validateDocumentFamilyAdapter(merged);
  resolved.set(normalizedId, validated);
  return validated;
}

export class DocumentFamilyAdapterRegistry {
  constructor(adapters = []) {
    this.adapters = new Map();
    this.familyIndex = new Map();
    for (const adapter of adapters) this.register(adapter);
  }

  register(adapter = {}) {
    const validated = validateDocumentFamilyAdapter(adapter);
    if (this.adapters.has(validated.adapterId)) {
      throw new Error(`Duplicate DocumentFamilyAdapter adapterId: ${validated.adapterId}`);
    }
    this.adapters.set(validated.adapterId, validated);
    const entries = this.familyIndex.get(validated.docFamily) || [];
    entries.push(validated.adapterId);
    this.familyIndex.set(validated.docFamily, entries);
    return validated;
  }

  get(adapterId = DEFAULT_DOCUMENT_FAMILY_ADAPTER_ID) {
    return clone(this.adapters.get(normalizeId(adapterId)) || this.adapters.get(DEFAULT_DOCUMENT_FAMILY_ADAPTER_ID) || null);
  }

  list() {
    return Array.from(this.adapters.values()).map((entry) => clone(entry));
  }

  resolve(input = {}) {
    const requestedAdapterId = normalizeString(input.adapterId || input.adapter_id);
    if (requestedAdapterId) {
      const adapter = this.get(requestedAdapterId);
      if (!adapter) throw new Error(`DocumentFamilyAdapter requested but not registered: ${requestedAdapterId}`);
      return { ...adapter, resolution: { resolvedBy: 'adapter_id', score: 1000 } };
    }

    const explicitFamily = normalizeDocumentFamily(
      input.docFamily
        || input.documentFamily
        || input.familyHint
        || input.structuredDoc?.docFamily
        || input.structuredDoc?.documentFamily
        || input.structuredDoc?.docType,
    );
    const issuerText = normalizeString(input.issuer || input.issuerHint || input.structuredDoc?.issuer || input.metadata?.issuer);
    const contextText = [
      input.filename,
      input.title,
      input.documentCode,
      input.sourceType,
      input.familyHint,
      issuerText,
      input.content,
      ...(Array.isArray(input.normalizedBlocks)
        ? input.normalizedBlocks.slice(0, 30).map((block) => `${block.title || ''}\n${block.text || ''}`)
        : []),
    ].map((entry) => normalizeString(entry)).filter(Boolean).join('\n');

    const ranked = this.list()
      .map((adapter) => ({ adapter, score: scoreAdapter(adapter, { explicitFamily, issuerText, contextText, input }) }))
      .filter((entry) => entry.score > 0)
      .sort((left, right) => right.score - left.score || normalizeId(left.adapter.adapterId).localeCompare(normalizeId(right.adapter.adapterId)));

    const selected = ranked[0]?.adapter || this.get(DEFAULT_DOCUMENT_FAMILY_ADAPTER_ID);
    return {
      ...selected,
      resolution: {
        resolvedBy: ranked[0] ? 'document_family_adapter' : 'generic_adapter',
        score: ranked[0]?.score || 1,
        explicitFamily: explicitFamily || null,
      },
    };
  }

  static loadFromDirectory(dir = DEFAULT_DOCUMENT_FAMILY_ADAPTER_DIR, { optional = false } = {}) {
    const normalizedDir = path.resolve(String(dir || ''));
    if (!fs.existsSync(normalizedDir)) {
      if (optional) return new DocumentFamilyAdapterRegistry();
      throw new Error(`DocumentFamilyAdapter directory not found: ${normalizedDir}`);
    }

    const rawById = new Map();
    for (const filename of fs.readdirSync(normalizedDir).sort()) {
      if (!/\.json$/iu.test(filename)) continue;
      const filePath = path.join(normalizedDir, filename);
      const raw = readJsonFile(filePath);
      const adapterId = normalizeId(raw.adapterId || path.basename(filename, '.json'));
      if (rawById.has(adapterId)) throw new Error(`Duplicate DocumentFamilyAdapter adapterId: ${adapterId}`);
      rawById.set(adapterId, { ...raw, adapterId });
    }

    const resolved = new Map();
    for (const adapterId of rawById.keys()) {
      resolveExtends(adapterId, rawById, new Set(), resolved);
    }
    return new DocumentFamilyAdapterRegistry(Array.from(resolved.values()));
  }
}

function matchAnyPattern(patterns = [], text = '') {
  return asArray(patterns).some((pattern) => {
    try {
      return new RegExp(String(pattern), 'iu').test(text);
    } catch (error) {
      throw new Error(`Invalid DocumentFamilyAdapter match regex ${pattern}: ${error.message}`);
    }
  });
}

function matchAnyToken(values = [], target = '') {
  const normalizedTarget = normalizeToken(target);
  if (!normalizedTarget) return false;
  return asArray(values).some((value) => normalizeToken(value) === normalizedTarget);
}

function hasDirectiveAuxiliarySourceIdentity(text = '') {
  return /\b(?:referenced\s+service\s+information|service\s+information|auxiliary\s+source)\b/iu.test(String(text || ''));
}

function hasDirectiveCurrentSourceIdentity(text = '') {
  return /\b(?:airworthiness\s+directive|(?:FAA|EASA|CAAC)?\s*AD[-_\s]*\d{4}[-_\s]*\d+)\b/iu.test(String(text || ''));
}

function hasServiceLetterDocumentIdentity(text = '') {
  return /\b(?:service\s+letter|SL[-_\s]*[A-Z0-9-]+)\b/iu.test(String(text || ''));
}

function scoreAdapter(adapter = {}, { explicitFamily = '', issuerText = '', contextText = '', input = {} } = {}) {
  const matchPolicy = adapter.matchPolicy || {};
  if (
    hasDirectiveAuxiliarySourceIdentity(contextText)
    && !hasDirectiveCurrentSourceIdentity(contextText)
    && !hasServiceLetterDocumentIdentity(contextText)
    && adapter.docFamily !== 'GENERIC'
  ) {
    return 0;
  }
  let score = 0;
  let matched = false;
  let issuerMatched = false;
  let contentMatched = false;

  if (explicitFamily) {
    if (adapter.docFamily !== explicitFamily) return 0;
    score += 120;
    matched = true;
  }

  if (matchAnyToken(matchPolicy.sourceTypes || [], input.sourceType)) {
    score += 90;
    matched = true;
    contentMatched = true;
  }
  if (matchAnyPattern(matchPolicy.filenamePatterns || [], normalizeString(input.filename))) {
    score += 70;
    matched = true;
    contentMatched = true;
  }
  if (matchAnyPattern(matchPolicy.textPatterns || [], contextText)) {
    score += 45;
    matched = true;
    contentMatched = true;
  }
  if (matchAnyPattern(matchPolicy.documentCodePatterns || [], normalizeString(input.documentCode))) {
    score += 65;
    matched = true;
    contentMatched = true;
  }
  if (matchAnyPattern(matchPolicy.docFamilyPatterns || [], contextText)) {
    score += 35;
    matched = true;
    contentMatched = true;
  }

  const issuerAliases = [
    ...(adapter.issuerPolicy?.issuerAliases || []),
    ...(matchPolicy.issuerAliases || []),
  ];
  if (issuerAliases.length > 0 && (matchAnyPattern(issuerAliases, issuerText) || matchAnyPattern(issuerAliases, contextText))) {
    score += 20;
    matched = true;
    issuerMatched = true;
  }

  if (adapter.adapterId === DEFAULT_DOCUMENT_FAMILY_ADAPTER_ID) score += 1;
  if (!matched && adapter.adapterId !== DEFAULT_DOCUMENT_FAMILY_ADAPTER_ID) return 0;
  if (explicitFamily && adapter.issuerPolicy?.issuer && adapter.issuerPolicy.issuer !== 'GENERIC' && !contentMatched) return 0;
  if (!explicitFamily && adapter.issuerPolicy?.issuer && adapter.issuerPolicy.issuer !== 'GENERIC' && !contentMatched) return 0;
  if (issuerMatched && adapter.issuerPolicy?.issuer && adapter.issuerPolicy.issuer !== 'GENERIC') score += 100;
  return score + Number(matchPolicy.priority || 0);
}

export function getDocumentFamilyAdapterRegistry() {
  if (!cachedRegistry) {
    cachedRegistry = DocumentFamilyAdapterRegistry.loadFromDirectory(DEFAULT_DOCUMENT_FAMILY_ADAPTER_DIR);
  }
  return cachedRegistry;
}

export function listDocumentFamilyAdapters() {
  return getDocumentFamilyAdapterRegistry().list();
}

export function getDocumentFamilyAdapter(adapterId = DEFAULT_DOCUMENT_FAMILY_ADAPTER_ID) {
  return getDocumentFamilyAdapterRegistry().get(adapterId);
}

export function resolveDocumentFamilyAdapter(input = {}) {
  return getDocumentFamilyAdapterRegistry().resolve(input);
}
