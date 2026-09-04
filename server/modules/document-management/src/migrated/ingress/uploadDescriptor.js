import {
  normalizeDocumentFamily,
  resolveDocumentFamilyAdapter,
} from '../adapters/documentFamilyAdapterRegistry.js';
import {
  detectDocumentDimensions,
  inferSourceType,
} from '../adapters/parserSourceTypeDetector.js';

// Migrated from apps/api/src/productSurfaceRuntime.js at WiseLink codex/0-11
// HEAD 77615d745eb999e89caf0a0c4bcd29d8712d33e8. The functions retain the
// current classification order; exports and the access-control seam are the
// only extraction changes.

const DEFAULT_DESCRIPTOR = Object.freeze({
  mediaType: 'application/pdf',
  sourceKind: 'external_real_pdf_upload_descriptor',
  copiedIntoTargetRepository: false,
});

const DOCUMENT_CATEGORY_FAMILY_MAP = Object.freeze({
  ameco_engineering_order: 'AEO',
  aeo: 'AEO',
  boeing_ftd: 'FTD',
  boeing_asb: 'SB',
  alert_service_bulletin: 'SB',
  boeing_mpd: 'MT',
  boeing_maintenance_tip: 'MT',
  maintenance_tip: 'MT',
  mpd: 'MT',
  mt: 'MT',
  sb: 'SB',
  sl: 'SL',
  rb: 'RB',
  sil: 'SIL',
  ad: 'AD',
  amm: 'MT',
  airbus_sb: 'SB',
  airbus_sbit: 'SB',
  airbus_aot: 'SB',
  airbus_oit: 'SB',
  airbus_fot: 'SB',
  airbus_ril: 'SB',
  airbus_als: 'MT',
  airbus_cmp: 'MT',
  airbus_tfu: 'GENERIC',
  airbus_concession: 'GENERIC',
  airbus_ame: 'GENERIC',
  generic: 'GENERIC',
});

function normalizeString(value, fallback = '') {
  if (value === null || value === undefined) return fallback;
  const normalized = String(value).trim();
  return normalized || fallback;
}

function asPlainObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function normalizeStringArray(values) {
  return (Array.isArray(values) ? values : [])
    .map((value) => normalizeString(
      value && typeof value === 'object'
        ? value.user_id || value.userId || value.actor_ref || value.actorRef
        : value,
      '',
    ))
    .filter(Boolean);
}

function normalizeVisibilityScope(value = '', fallback = 'local_workspace') {
  const normalized = normalizeString(value, fallback);
  return [
    'local_workspace',
    'tenant',
    'document_participants',
    'owner_only',
    'admin_only',
    'hidden_evidence',
    'no_public_projection',
  ].includes(normalized) ? normalized : fallback;
}

export function normalizeObjectAccessControl(value = {}, options = {}) {
  const record = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const tenantId = normalizeString(record.tenant_id || record.tenantId, '');
  const workspaceId = normalizeString(record.workspace_id || record.workspaceId, '');
  const ownerUserId = normalizeString(
    record.owner_user_id
      || record.ownerUserId
      || record.requested_by_user_id
      || record.requestedByUserId,
    '',
  );
  const ownerRef = normalizeString(record.owner_ref || record.ownerRef, '');
  const participantUserIds = normalizeStringArray(
    record.participant_user_ids || record.participantUserIds || record.participants,
  );
  const participantRefs = normalizeStringArray(record.participant_refs || record.participantRefs);
  const visibilityScope = normalizeVisibilityScope(
    record.visibility_scope || record.visibilityScope || options.visibilityScope,
    'local_workspace',
  );
  const objectBound = record.object_bound === true
    || record.objectBound === true
    || Boolean(tenantId || workspaceId || ownerUserId || ownerRef || participantUserIds.length || participantRefs.length);
  return {
    schemaVersion: 'wiselink.0_10.object_access_control.v1',
    tenant_id: tenantId,
    workspace_id: workspaceId,
    owner_user_id: ownerUserId,
    owner_ref: ownerRef,
    participant_user_ids: Array.from(new Set(participantUserIds)).slice(0, 100),
    participant_refs: Array.from(new Set(participantRefs)).slice(0, 100),
    visibility_scope: visibilityScope,
    object_bound: objectBound,
  };
}

function normalizeRuntimeExecutionTraceContext(value = {}) {
  const record = asPlainObject(value);
  return {
    runId: normalizeString(record.runId || record.runtimeTraceRunId, ''),
    scenarioId: normalizeString(record.scenarioId, ''),
    correlationId: normalizeString(record.correlationId, ''),
    actorRef: normalizeString(record.actorRef, ''),
    sessionRef: normalizeString(record.sessionRef || record.sessionId, ''),
    actorScope: normalizeString(record.actorScope, ''),
    visibilityScope: normalizeString(record.visibilityScope, ''),
  };
}

export function normalizeDocumentIngressRevisionDate(value = '') {
  const source = normalizeString(value, '');
  if (!source) return '';
  const iso = source.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/u);
  if (iso) return validDocumentIngressDate(iso[1], iso[2], iso[3]);
  const us = source.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/u);
  if (us) return validDocumentIngressDate(us[3], us[1], us[2]);
  const compact = source.match(/^(\d{2})(\d{2})(\d{4})$/u);
  if (compact) return validDocumentIngressDate(compact[3], compact[1], compact[2]);
  return '';
}

function validDocumentIngressDate(yearValue, monthValue, dayValue) {
  const year = Number(yearValue);
  const month = Number(monthValue);
  const day = Number(dayValue);
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return '';
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return '';
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function normalizeDescriptorDocumentFamily(value = '') {
  const explicit = normalizeString(value);
  if (!explicit) return '';
  const adapterFamily = normalizeDocumentFamily(explicit);
  if (adapterFamily) return adapterFamily;
  const normalized = explicit.toUpperCase();
  // 3.1 catalog-only delta: accept only an explicit governed classification;
  // filenames and Parser adapter profiles must not invent this family.
  if (normalized === 'OEM_REFERENCE' || normalized === 'OEM REFERENCE') return 'OEM_REFERENCE';
  if (/\bFTD\b|FLEET\s+TEAM\s+DIGEST/u.test(normalized)) return 'FTD';
  if (/\b(?:ASB|SB)\b|SERVICE\s+BULLETIN/u.test(normalized)) return 'SB';
  if (/\bSL\b|SERVICE\s+LETTER/u.test(normalized)) return 'SL';
  if (/\bSIL\b|SERVICE\s+INFORMATION\s+LETTER|SUPPLIER\s+SERVICE/u.test(normalized)) return 'SIL';
  if (/\bAD\b|AIRWORTHINESS\s+DIRECTIVE|CAD|EAD/u.test(normalized)) return 'AD';
  if (/\bRB\b|REQUIREMENTS?\s+BULLETIN/u.test(normalized)) return 'RB';
  if (/\bMPD\b|MAINTENANCE\s+(?:TIP|TASK|PLANNING)|\bMT\b/u.test(normalized)) return 'MT';
  if (/GENERAL|GENERIC|UNKNOWN/u.test(normalized)) return 'GENERIC';
  return '';
}

function normalizeApiSourceType(value = '') {
  const normalized = normalizeString(value).toLowerCase().replace(/[^a-z0-9]+/gu, '_').replace(/^_+|_+$/gu, '');
  if (!normalized) return '';
  if (['ftd', 'boeing_fleet_team_digest', 'fleet_team_digest'].includes(normalized)) return 'boeing_ftd';
  if (['asb', 'alert_service_bulletin', 'boeing_asb'].includes(normalized)) return 'boeing_asb';
  if (['boeing_service_bulletin', 'boeing_sb', 'service_bulletin', 'sb'].includes(normalized)) return 'boeing_sb';
  if (['boeing_service_letter', 'boeing_sl', 'service_letter', 'sl'].includes(normalized)) return 'boeing_sl';
  if (['supplier_service_information_letter', 'service_information_letter', 'supplier_sil', 'sil', 'honeywell_sil'].includes(normalized)) return 'supplier_sil';
  if (['airworthiness_directive', 'faa_ad', 'easa_ad', 'caac_ad', 'cad', 'ead', 'ad'].includes(normalized)) return 'ad';
  if (['aeo', 'engineering_order', 'ameco_engineering_order'].includes(normalized)) return 'ameco_engineering_order';
  if (['requirements_bulletin', 'requirement_bulletin', 'rb'].includes(normalized)) return 'requirements_bulletin';
  if (['boeing_mpd', 'mpd', 'maintenance_planning_document'].includes(normalized)) return 'boeing_mpd';
  if (['boeing_maintenance_tip', 'maintenance_tip', 'maintenance_task', 'mt'].includes(normalized)) return 'boeing_maintenance_tip';
  return normalized;
}

function familyFromDocumentCategory(category = '') {
  const normalized = normalizeApiSourceType(category);
  if (!normalized || normalized === 'generic') return '';
  return DOCUMENT_CATEGORY_FAMILY_MAP[normalized]
    || DOCUMENT_CATEGORY_FAMILY_MAP[normalizeString(category).toLowerCase()]
    || '';
}

function familyFromSourceType(sourceType = '') {
  const normalized = normalizeApiSourceType(sourceType);
  if (!normalized) return '';
  if (normalized === 'oem_reference') return 'OEM_REFERENCE';
  if (normalized === 'boeing_ftd') return 'FTD';
  if (normalized === 'boeing_asb' || normalized === 'boeing_sb' || normalized.startsWith('airbus_service_bulletin') || normalized.startsWith('airbus_operator_transmission') || normalized.startsWith('airbus_retrofit_information_letter')) return 'SB';
  if (normalized === 'boeing_sl') return 'SL';
  if (normalized === 'supplier_sil') return 'SIL';
  if (normalized === 'ad') return 'AD';
  if (normalized === 'ameco_engineering_order') return 'AEO';
  if (normalized === 'requirements_bulletin') return 'RB';
  if (normalized === 'boeing_mpd' || normalized === 'boeing_maintenance_tip' || normalized === 'airbus_maintenance_programme') return 'MT';
  if (normalized === 'generic' || normalized === 'generic_pdf' || normalized === 'pdf' || normalized === 'word') return 'GENERIC';
  return '';
}

function resolveStrongFilenameDocumentClassification(filename = '') {
  const normalized = normalizeString(filename, '').toUpperCase();
  if (/^MTM(?:[-_\s]|$)/u.test(normalized)) {
    return { documentFamily: 'GENERIC', sourceType: 'generic' };
  }
  return { documentFamily: '', sourceType: '' };
}

function defaultSourceTypeForFamily(canonicalDocumentFamily = '', context = {}) {
  const category = normalizeString(context.documentCategory).toLowerCase();
  const displayFamily = normalizeString(context.displayFamily).toLowerCase();
  const filename = normalizeString(context.originalFilename).toLowerCase();
  if (canonicalDocumentFamily === 'FTD') return 'boeing_ftd';
  if (canonicalDocumentFamily === 'AD') return 'ad';
  if (canonicalDocumentFamily === 'AEO') return 'ameco_engineering_order';
  if (canonicalDocumentFamily === 'SL') return /boeing|(?:^|[^a-z0-9])(?:737|747|767|777|787)[-_\s]*sl/u.test(`${displayFamily}\n${filename}`) ? 'boeing_sl' : 'service_letter';
  if (canonicalDocumentFamily === 'SIL') return 'supplier_sil';
  if (canonicalDocumentFamily === 'RB') return 'requirements_bulletin';
  if (canonicalDocumentFamily === 'MT') {
    if (category.includes('mpd')) return 'boeing_mpd';
    if (category.includes('maintenance_tip')) return 'boeing_maintenance_tip';
    return 'maintenance_task';
  }
  if (canonicalDocumentFamily === 'OEM_REFERENCE') return 'oem_reference';
  if (canonicalDocumentFamily === 'SB') {
    if (category.startsWith('airbus_')) {
      return {
        airbus_sb: 'airbus_service_bulletin',
        airbus_sbit: 'airbus_operator_transmission',
        airbus_aot: 'airbus_operator_transmission',
        airbus_oit: 'airbus_operator_transmission',
        airbus_fot: 'airbus_operator_transmission',
        airbus_ril: 'airbus_retrofit_information_letter',
      }[category] || 'airbus_service_bulletin';
    }
    if (/alert[-_\s]*service[-_\s]*bulletin|(?:^|[^a-z0-9])asb(?:[^a-z0-9]|$)|(?:^|[^a-z0-9])(?:737|747|767|777|787)[-_\s]*\d{2}a\d{4}/u.test(`${displayFamily}\n${filename}`)) return 'boeing_asb';
    return /boeing|(?:^|[^a-z0-9])(?:737|747|767|777|787)[-_\s]*\d{2}/u.test(`${displayFamily}\n${filename}`) ? 'boeing_sb' : 'service_bulletin';
  }
  return 'generic';
}

function resolveDisplayDocumentFamily({ explicitFamily = '', canonicalDocumentFamily = '', sourceType = '' } = {}) {
  const explicit = normalizeString(explicitFamily);
  if (explicit) return explicit;
  if (canonicalDocumentFamily === 'SB' && sourceType === 'boeing_asb') return 'Boeing ASB';
  if (canonicalDocumentFamily === 'SB' && /^boeing_/u.test(sourceType)) return 'Boeing SB';
  if (canonicalDocumentFamily === 'SL' && /^boeing_/u.test(sourceType)) return 'Boeing SL';
  if (canonicalDocumentFamily === 'FTD') return 'FTD';
  if (canonicalDocumentFamily === 'AD') return 'AD';
  if (canonicalDocumentFamily === 'AEO') return 'AEO';
  if (canonicalDocumentFamily === 'SIL') return 'SIL';
  if (canonicalDocumentFamily === 'RB') return 'RB';
  if (canonicalDocumentFamily === 'MT') return 'MT';
  if (canonicalDocumentFamily === 'OEM_REFERENCE') return 'OEM Reference';
  return canonicalDocumentFamily || 'GENERIC';
}

export function resolveUploadDescriptorClassification(descriptor = {}) {
  const metadata = asPlainObject(descriptor.metadata);
  const originalFilename = normalizeString(descriptor.originalFilename || descriptor.fileName, '');
  const documentCode = normalizeString(descriptor.documentCode, '');
  const explicitFamily = normalizeDescriptorDocumentFamily(descriptor.documentFamily || metadata.documentFamily || metadata.document_family);
  const explicitSpecificFamily = explicitFamily && explicitFamily !== 'GENERIC' ? explicitFamily : '';
  const explicitSourceType = normalizeApiSourceType(
    descriptor.sourceType || descriptor.source_type || metadata.sourceType || metadata.source_type,
  );
  const explicitSpecificSourceType = explicitSourceType && !['generic', 'generic_pdf', 'pdf'].includes(explicitSourceType)
    ? explicitSourceType
    : '';
  const searchableContext = [
    originalFilename,
    documentCode,
    descriptor.documentFamily,
    descriptor.documentTitle,
    descriptor.title,
    descriptor.issuer,
    metadata.issuer,
    descriptor.sourceType,
    metadata.sourceType,
  ].map((entry) => normalizeString(entry)).filter(Boolean).join('\n');
  const dimensions = detectDocumentDimensions({
    filename: originalFilename,
    content: searchableContext,
    metadata: {
      ...metadata,
      sourceType: explicitSourceType || metadata.sourceType || metadata.source_type,
      documentCategory: descriptor.documentCategory || descriptor.document_category || metadata.documentCategory || metadata.document_category,
    },
    documentCategory: descriptor.documentCategory || descriptor.document_category || metadata.documentCategory || metadata.document_category,
  });
  const inferredSourceType = normalizeApiSourceType(inferSourceType({
    filename: originalFilename,
    content: searchableContext,
    metadata: { ...metadata, sourceType: explicitSourceType || '' },
  }));
  const documentCategoryFamily = familyFromDocumentCategory(dimensions.documentCategory);
  const strongFilenameClassification = resolveStrongFilenameDocumentClassification(originalFilename);
  const strongFilenameFamily = strongFilenameClassification.documentFamily;
  const inferredSpecificSourceType = inferredSourceType && !['generic', 'boeing', 'airbus', 's1000d', 'pdf', 'word'].includes(inferredSourceType)
    ? inferredSourceType
    : '';
  const adapter = resolveDocumentFamilyAdapter({
    adapterId: descriptor.documentFamilyAdapterId,
    filename: originalFilename,
    documentCode,
    documentFamily: explicitSpecificFamily,
    familyHint: explicitSpecificFamily,
    sourceType: explicitSpecificSourceType || inferredSpecificSourceType || inferredSourceType,
    issuer: descriptor.issuer || metadata.issuer,
    title: descriptor.documentTitle || descriptor.title || metadata.title,
    content: searchableContext,
    metadata,
  });
  const adapterFamily = adapter?.adapterId && adapter.adapterId !== 'generic.general_document.v1'
    ? normalizeDescriptorDocumentFamily(adapter.docFamily)
    : '';
  const adapterSourceType = adapter?.subtype === 'alert_service_bulletin' ? 'boeing_asb' : '';
  const adapterDocumentCategory = adapterSourceType || '';
  const canonicalDocumentFamily = strongFilenameFamily
    || explicitSpecificFamily
    || familyFromSourceType(explicitSpecificSourceType)
    || documentCategoryFamily
    || adapterFamily
    || familyFromSourceType(inferredSpecificSourceType)
    || explicitFamily
    || 'GENERIC';
  const sourceType = strongFilenameClassification.sourceType
    || explicitSpecificSourceType
    || adapterSourceType
    || inferredSpecificSourceType
    || defaultSourceTypeForFamily(canonicalDocumentFamily, {
      displayFamily: descriptor.documentFamily,
      documentCategory: dimensions.documentCategory,
      originalFilename,
    });
  return {
    displayDocumentFamily: resolveDisplayDocumentFamily({
      explicitFamily: !strongFilenameFamily && explicitSpecificFamily
        ? descriptor.documentFamily || metadata.documentFamily || metadata.document_family
        : '',
      canonicalDocumentFamily,
      sourceType,
    }),
    canonicalDocumentFamily,
    sourceType,
    documentCategory: normalizeString(dimensions.documentCategory, 'generic') === 'generic' && adapterDocumentCategory
      ? adapterDocumentCategory
      : normalizeString(dimensions.documentCategory, 'generic'),
    parserFormat: normalizeString(dimensions.parserFormat, 'pdf'),
    adapterRelease: canonicalDocumentFamily === 'OEM_REFERENCE' ? null : adapter ? {
      adapterId: adapter.adapterId,
      adapterVersion: adapter.schemaVersion,
      adapterHash: '',
    } : null,
  };
}

export function normalizeBoeingBulletinDocumentIdentity({
  documentCode = '',
  canonicalDocumentFamily = '',
  sourceType = '',
} = {}) {
  const code = normalizeString(documentCode, '').toUpperCase();
  const family = normalizeDescriptorDocumentFamily(canonicalDocumentFamily);
  const normalizedSourceType = normalizeApiSourceType(sourceType);
  if (family !== 'SB' || !['boeing_asb', 'boeing_sb'].includes(normalizedSourceType)) {
    return { documentCode: code, businessRevision: '' };
  }
  const match = code.match(
    /^((?:737|747|757|767|777|787)-\d{2}[A-Z]?\d{4})\s+(?:R(?:EV)?\s*0*(\d+)|REVISION\s+0*(\d+))$/u,
  );
  if (!match) return { documentCode: code, businessRevision: '' };
  const revisionNumber = Number(match[2] ?? match[3] ?? 0);
  return { documentCode: match[1], businessRevision: `R${revisionNumber}` };
}

export function normalizeUploadDescriptor(descriptor = {}) {
  if (descriptor.sourceRuntimeJsonCopiedAsAuthority === true) {
    throw Object.assign(new Error('Source runtime JSON authority import is forbidden.'), { statusCode: 400, code: 'SOURCE_RUNTIME_JSON_FORBIDDEN' });
  }
  if (descriptor.copiedIntoTargetRepository === true) {
    throw Object.assign(new Error('P13 upload descriptor cannot claim Docs/uploads copied into target repository.'), { statusCode: 400, code: 'DOCS_UPLOADS_COPY_FORBIDDEN' });
  }
  const sha256 = normalizeString(descriptor.sha256).toLowerCase();
  if (!/^[a-f0-9]{64}$/u.test(sha256)) {
    throw Object.assign(new Error('Upload descriptor requires a sha256 digest.'), { statusCode: 400, code: 'UPLOAD_DESCRIPTOR_SHA_REQUIRED' });
  }
  const sizeBytes = Number(descriptor.sizeBytes || 0);
  if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) {
    throw Object.assign(new Error('Upload descriptor requires positive sizeBytes.'), { statusCode: 400, code: 'UPLOAD_DESCRIPTOR_SIZE_REQUIRED' });
  }
  const classification = resolveUploadDescriptorClassification(descriptor);
  const normalizedBoeingBulletinIdentity = normalizeBoeingBulletinDocumentIdentity({
    documentCode: descriptor.documentCode,
    canonicalDocumentFamily: classification.canonicalDocumentFamily,
    sourceType: classification.sourceType,
  });
  const pageCount = Number(descriptor.pageCount || 0);
  return {
    originalFilename: normalizeString(descriptor.originalFilename || descriptor.fileName, ''),
    mediaType: normalizeString(descriptor.mediaType, DEFAULT_DESCRIPTOR.mediaType),
    documentCode: normalizeString(normalizedBoeingBulletinIdentity.documentCode, ''),
    documentFamily: classification.displayDocumentFamily,
    canonicalDocumentFamily: classification.canonicalDocumentFamily,
    sourceType: classification.sourceType,
    detectedDocumentCategory: classification.documentCategory,
    parserFormat: classification.parserFormat,
    adapterRelease: classification.adapterRelease,
    identityAuthority: normalizeString(descriptor.identityAuthority, ''),
    issuer: normalizeString(descriptor.issuer || descriptor.metadata?.issuer, ''),
    airplaneModel: normalizeString(descriptor.airplaneModel, ''),
    sha256,
    sizeBytes,
    pageCount: Number.isSafeInteger(pageCount) && pageCount > 0 ? pageCount : 0,
    sourceKind: normalizeString(descriptor.sourceKind, DEFAULT_DESCRIPTOR.sourceKind),
    sourcePath: normalizeString(descriptor.sourcePath || descriptor.localSourcePath || descriptor.controlledSourcePath, ''),
    sourceStorageKey: normalizeString(descriptor.sourceStorageKey, ''),
    mineruArtifactManifestRelativePath: normalizeString(descriptor.mineruArtifactManifestRelativePath, ''),
    mineruArtifactSetSha256: normalizeString(descriptor.mineruArtifactSetSha256, ''),
    businessRevision: normalizeString(
      descriptor.businessRevision
      || descriptor.revisionLabel
      || descriptor.metadata?.businessRevision
      || descriptor.metadata?.revisionLabel,
      normalizedBoeingBulletinIdentity.businessRevision,
    ),
    revisionDate: normalizeDocumentIngressRevisionDate(
      descriptor.revisionDate
      || descriptor.lastRevisedDate
      || descriptor.metadata?.revisionDate
      || descriptor.metadata?.lastRevisedDate,
    ),
    sourceGeneratedDate: normalizeDocumentIngressRevisionDate(
      descriptor.sourceGeneratedDate
      || descriptor.generatedDate
      || descriptor.metadata?.sourceGeneratedDate
      || descriptor.metadata?.generatedDate,
    ),
    accessControl: normalizeObjectAccessControl(descriptor.accessControl || {}),
    runtimeTraceContext: normalizeRuntimeExecutionTraceContext(descriptor.runtimeTraceContext),
    copiedIntoTargetRepository: false,
    sourceRuntimeJsonCopiedAsAuthority: false,
  };
}
