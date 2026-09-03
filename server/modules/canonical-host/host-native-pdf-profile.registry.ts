import type { CanonicalClassificationSelection } from '@shared/api.interface';
import {
  getDocumentFamilyAdapter,
  resolveDocumentFamilyAdapter,
} from '../document-management/src/migrated/adapters/documentFamilyAdapterRegistry.js';
import {
  jcsCanonicalize,
  sha256Hex,
} from '../professional-input/pure/canonical-hash';
import type { ParsedPdfLayout } from '../professional-input/pure/professional-input-pure.types';

export type HostNativePdfDocumentType =
  | 'airworthiness_directive'
  | 'fleet_team_digest'
  | 'maintenance_programme'
  | 'maintenance_tip'
  | 'operator_transmission'
  | 'retrofit_information_letter'
  | 'service_bulletin'
  | 'service_information_letter'
  | 'service_letter';

export interface HostNativePdfProfile {
  readonly adapterId: string;
  readonly adapterSchemaVersion: string;
  readonly family: 'AD' | 'FTD' | 'MT' | 'SB' | 'SIL' | 'SL';
  readonly issuerAuthority: string;
  readonly parseProfileRef: string;
  readonly parserProfileId: string;
  readonly parserProfileHash: string;
  readonly documentType: HostNativePdfDocumentType;
  readonly requiresDmAdapterRelease: boolean;
  readonly presentationMode: 'ENGINEERING_DOCUMENT';
  readonly executionRoute: string;
  readonly evidence: {
    readonly kind: 'PDF_SOURCE_TITLE_AND_TEXT';
    readonly inspectedPageCount: number;
    readonly inspectedTextLength: number;
    readonly registryScore: number;
  };
}

interface ActivatedProfileDefinition {
  readonly adapterId: string;
  readonly family: HostNativePdfProfile['family'];
  readonly issuerAuthority: string;
  readonly parseProfileRef: string;
  readonly documentType: HostNativePdfDocumentType;
  readonly requiresDmAdapterRelease?: boolean;
  readonly parserProfileHashOverride?: string;
}

const CLASSIFIER_RELEASE_ID =
  'intake-classifier-release:q1-native-migration@1.0.0';
const CLASSIFIER_RELEASE_HASH =
  'sha256:d374483eaa1c209912bf8ed0f830b582f8f0578e3149899de24633ad8e10587c';
const PROFILE_VERSION = '1.0.0';
const PROFILE_SCHEMA_VERSION = 'v8.4-document-family-adapter.v1';
const PROFILE_EVIDENCE_PAGE_LIMIT = 3;
const PROFILE_EVIDENCE_CHARACTER_LIMIT = 120_000;
const EXECUTION_ROUTE =
  'file_service_source->host_native_pdf_pipeline->host_scoped_professional_artifact->u0_frozen2_strict_validator';

const ACTIVATED_PROFILE_DEFINITIONS = [
  {
    adapterId: 'issuer.boeing.ftd.v1',
    family: 'FTD',
    issuerAuthority: 'BOEING',
    parseProfileRef: 'boeing.ftd.v1',
    documentType: 'fleet_team_digest',
    parserProfileHashOverride:
      'sha256:c47a7388da23d106c2476b579308c458332127153930ced8c684212f1b431731',
  },
  {
    adapterId: 'issuer.boeing.service_bulletin.v1',
    family: 'SB',
    issuerAuthority: 'BOEING',
    parseProfileRef: 'boeing.sb',
    documentType: 'service_bulletin',
    parserProfileHashOverride:
      'sha256:f87dbe8607c4958f253f980bc459cea062e7ebc1e7e8c65353549399cb07f3c0',
  },
  {
    adapterId: 'issuer.airbus.service_bulletin.v1',
    family: 'SB',
    issuerAuthority: 'AIRBUS',
    parseProfileRef: 'airbus.sb',
    documentType: 'service_bulletin',
  },
  {
    adapterId: 'issuer.boeing.service_letter.v1',
    family: 'SL',
    issuerAuthority: 'BOEING',
    parseProfileRef: 'boeing.sl',
    documentType: 'service_letter',
  },
  {
    adapterId: 'issuer.faa.airworthiness_directive.v1',
    family: 'AD',
    issuerAuthority: 'FAA',
    parseProfileRef: 'faa.ad',
    documentType: 'airworthiness_directive',
  },
  {
    adapterId: 'issuer.easa.airworthiness_directive.v1',
    family: 'AD',
    issuerAuthority: 'EASA',
    parseProfileRef: 'easa.ad',
    documentType: 'airworthiness_directive',
  },
  {
    adapterId: 'issuer.caac.cad.v1',
    family: 'AD',
    issuerAuthority: 'CAAC',
    parseProfileRef: 'caac.cad',
    documentType: 'airworthiness_directive',
  },
  {
    adapterId: 'issuer.honeywell.sil.v1',
    family: 'SIL',
    issuerAuthority: 'HONEYWELL',
    parseProfileRef: 'honeywell.sil',
    documentType: 'service_information_letter',
    requiresDmAdapterRelease: true,
  },
  {
    adapterId: 'issuer.boeing.maintenance_tip.v1',
    family: 'MT',
    issuerAuthority: 'BOEING',
    parseProfileRef: 'boeing.maintenance_tip',
    documentType: 'maintenance_tip',
    requiresDmAdapterRelease: true,
  },
  {
    adapterId: 'issuer.airbus.retrofit_information_letter.v1',
    family: 'SB',
    issuerAuthority: 'AIRBUS',
    parseProfileRef: 'airbus.retrofit_information_letter',
    documentType: 'retrofit_information_letter',
    requiresDmAdapterRelease: true,
  },
  {
    adapterId: 'issuer.airbus.operator_transmission.v1',
    family: 'SB',
    issuerAuthority: 'AIRBUS',
    parseProfileRef: 'airbus.operator_transmission',
    documentType: 'operator_transmission',
    requiresDmAdapterRelease: true,
  },
  {
    adapterId: 'issuer.airbus.maintenance_programme.v1',
    family: 'MT',
    issuerAuthority: 'AIRBUS',
    parseProfileRef: 'airbus.maintenance_programme',
    documentType: 'maintenance_programme',
    requiresDmAdapterRelease: true,
  },
] as const satisfies readonly ActivatedProfileDefinition[];

const DEFINITIONS_BY_ADAPTER_ID: ReadonlyMap<
  string,
  ActivatedProfileDefinition
> = new Map<string, ActivatedProfileDefinition>(
  ACTIVATED_PROFILE_DEFINITIONS.map((definition) => [
    definition.adapterId,
    definition,
  ]),
);

/**
 * Resolve a production profile from the controlled DM family plus actual PDF
 * metadata/text. The family narrows cross-reference-heavy documents to the
 * current DM lane, but cannot activate an issuer profile without matching
 * source content. Filename, file digest, byte length, and document code are
 * deliberately absent. The producer later cross-checks the result against the
 * request classification and DM issuer.
 */
export function recognizeHostNativePdfProfile(
  layout: ParsedPdfLayout,
  expectedFamily: string,
): HostNativePdfProfile | null {
  const evidence = sourceProfileEvidence(layout);
  if (!evidence.content) return null;
  const resolved = resolveDocumentFamilyAdapter({
    documentFamily: expectedFamily,
    title: layout.metadata.title ?? '',
    content: evidence.content,
  }) as Record<string, unknown> | null;
  const adapterId = normalizedText(resolved?.adapterId);
  const definition = DEFINITIONS_BY_ADAPTER_ID.get(adapterId);
  if (!definition) return null;
  if (
    normalizedText(resolved?.docFamily) !== definition.family ||
    normalizedText(resolved?.parseProfileRef) !== definition.parseProfileRef
  ) {
    return null;
  }
  const adapterSchemaVersion = normalizedText(resolved?.schemaVersion);
  if (adapterSchemaVersion !== PROFILE_SCHEMA_VERSION) return null;
  const resolution = recordValue(resolved?.resolution);
  const registryScore = Number(resolution.score);
  if (!Number.isFinite(registryScore) || registryScore <= 0) return null;

  return materializeProfile(
    definition,
    {
      inspectedPageCount: evidence.inspectedPageCount,
      inspectedTextLength: evidence.content.length,
      registryScore,
    },
    resolved,
  );
}

export function hostNativePdfClassificationFor(input: {
  family: string;
  issuerAuthority: string;
  adapterId?: string;
}): CanonicalClassificationSelection | null {
  const definition = classificationDefinitionFor(input);
  if (!definition) return null;
  const profile = materializeProfile(definition, {
    inspectedPageCount: 0,
    inspectedTextLength: 0,
    registryScore: 0,
  });
  return {
    // A DM-owned adapter release is selected only after actual-byte identity,
    // issuer/family and adapter-version checks have committed.  That binding
    // is authoritative enough for Host routing; the family/issuer fallback
    // remains a candidate because it has not crossed that production seam.
    status: normalizedText(input.adapterId) ? 'CONFIRMED' : 'CANDIDATE',
    normalizedFamily: profile.family,
    classifierReleaseId: CLASSIFIER_RELEASE_ID,
    classifierReleaseHash: CLASSIFIER_RELEASE_HASH,
    parserProfileId: profile.parserProfileId,
    parserProfileHash: profile.parserProfileHash,
    fingerprint: profile.parserProfileHash,
  };
}

export function hostNativePdfAdapterIdFromDmPreflight(
  preflight: unknown,
): string {
  const row = recordValue(preflight);
  const descriptor = jsonRecordValue(row.normalizedDescriptorJson);
  const release = recordValue(descriptor.adapterRelease);
  if (normalizedText(release.adapterVersion) !== PROFILE_SCHEMA_VERSION) {
    return '';
  }
  return normalizedText(release.adapterId).toLowerCase();
}

export function matchesHostNativePdfClassification(
  profile: Pick<
    HostNativePdfProfile,
    'family' | 'parserProfileId' | 'parserProfileHash'
  >,
  classification: CanonicalClassificationSelection,
): boolean {
  return (
    classification.normalizedFamily === profile.family &&
    classification.parserProfileId === profile.parserProfileId &&
    classification.parserProfileHash === profile.parserProfileHash
  );
}

function classificationDefinitionFor(input: {
  family: string;
  issuerAuthority: string;
  adapterId?: string;
}): ActivatedProfileDefinition | null {
  const family = normalizedText(input.family).toUpperCase();
  const issuer = normalizedText(input.issuerAuthority).toUpperCase();
  const adapterId = normalizedText(input.adapterId).toLowerCase();
  if (adapterId) {
    const definition = DEFINITIONS_BY_ADAPTER_ID.get(adapterId);
    return definition &&
      definition.family === family &&
      definitionMatchesIssuer(definition, issuer)
      ? definition
      : null;
  }
  if (family === 'FTD' && issuer.includes('BOEING')) {
    return definitionFor('issuer.boeing.ftd.v1');
  }
  if (family === 'SB' && issuer.includes('AIRBUS')) {
    return definitionFor('issuer.airbus.service_bulletin.v1');
  }
  if (family === 'SB' && issuer.includes('BOEING')) {
    return definitionFor('issuer.boeing.service_bulletin.v1');
  }
  if (family === 'SL' && issuer.includes('BOEING')) {
    return definitionFor('issuer.boeing.service_letter.v1');
  }
  if (
    family === 'AD' &&
    (issuer === 'FAA' || issuer.includes('FEDERAL AVIATION'))
  ) {
    return definitionFor('issuer.faa.airworthiness_directive.v1');
  }
  if (family === 'AD' && issuer.includes('EASA')) {
    return definitionFor('issuer.easa.airworthiness_directive.v1');
  }
  if (
    family === 'AD' &&
    (issuer.includes('CAAC') || issuer.includes('中国民用航空局'))
  ) {
    return definitionFor('issuer.caac.cad.v1');
  }
  return null;
}

function definitionFor(adapterId: string): ActivatedProfileDefinition {
  const definition = DEFINITIONS_BY_ADAPTER_ID.get(adapterId);
  if (!definition)
    throw new Error(`HOST_NATIVE_PDF_PROFILE_MISSING:${adapterId}`);
  return definition;
}

function materializeProfile(
  definition: ActivatedProfileDefinition,
  evidence: {
    inspectedPageCount: number;
    inspectedTextLength: number;
    registryScore: number;
  },
  registryAdapterInput?: Record<string, unknown>,
): HostNativePdfProfile {
  const parserProfileId = `parser-profile:${definition.parseProfileRef}@${PROFILE_VERSION}`;
  const parserProfileHash =
    definition.parserProfileHashOverride ??
    registryAdapterHash(
      registryAdapterInput ??
        (getDocumentFamilyAdapter(definition.adapterId) as Record<
          string,
          unknown
        > | null),
      definition,
    );
  return {
    adapterId: definition.adapterId,
    adapterSchemaVersion: PROFILE_SCHEMA_VERSION,
    family: definition.family,
    issuerAuthority: definition.issuerAuthority,
    parseProfileRef: definition.parseProfileRef,
    parserProfileId,
    parserProfileHash,
    documentType: definition.documentType,
    requiresDmAdapterRelease: definition.requiresDmAdapterRelease === true,
    presentationMode: 'ENGINEERING_DOCUMENT',
    executionRoute: EXECUTION_ROUTE,
    evidence: {
      kind: 'PDF_SOURCE_TITLE_AND_TEXT',
      inspectedPageCount: evidence.inspectedPageCount,
      inspectedTextLength: evidence.inspectedTextLength,
      registryScore: evidence.registryScore,
    },
  };
}

function sourceProfileEvidence(layout: ParsedPdfLayout): {
  content: string;
  inspectedPageCount: number;
} {
  const inspectedPageCount = Math.min(
    layout.pageCount,
    PROFILE_EVIDENCE_PAGE_LIMIT,
  );
  const parts: string[] = [];
  let length = 0;
  for (const run of layout.textRuns) {
    if (run.page > inspectedPageCount) continue;
    const text = normalizedText(run.text);
    if (!text) continue;
    const remaining = PROFILE_EVIDENCE_CHARACTER_LIMIT - length;
    if (remaining <= 0) break;
    const part = text.slice(0, remaining);
    parts.push(part);
    length += part.length + 1;
  }
  return {
    content: parts.join(' '),
    inspectedPageCount,
  };
}

function normalizedText(value: unknown): string {
  return typeof value === 'string' ? value.replace(/\s+/gu, ' ').trim() : '';
}

function recordValue(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function jsonRecordValue(value: unknown): Record<string, unknown> {
  if (typeof value !== 'string' || !value.trim()) return {};
  try {
    return recordValue(JSON.parse(value));
  } catch {
    return {};
  }
}

function definitionMatchesIssuer(
  definition: ActivatedProfileDefinition,
  issuer: string,
): boolean {
  if (!issuer) return false;
  if (definition.issuerAuthority === 'FAA') {
    return issuer === 'FAA' || issuer.includes('FEDERAL AVIATION');
  }
  if (definition.issuerAuthority === 'CAAC') {
    return issuer.includes('CAAC') || issuer.includes('中国民用航空局');
  }
  return issuer.includes(definition.issuerAuthority);
}

function registryAdapterHash(
  adapter: Record<string, unknown> | null,
  definition: ActivatedProfileDefinition,
): string {
  if (
    normalizedText(adapter?.adapterId) !== definition.adapterId ||
    normalizedText(adapter?.schemaVersion) !== PROFILE_SCHEMA_VERSION ||
    normalizedText(adapter?.parseProfileRef) !== definition.parseProfileRef
  ) {
    throw new Error(
      `HOST_NATIVE_PDF_PROFILE_REGISTRY_IDENTITY_INVALID:${definition.adapterId}`,
    );
  }
  const canonicalAdapter = Object.fromEntries(
    Object.entries(adapter).filter(([key]) => key !== 'resolution'),
  );
  return `sha256:${sha256Hex(jcsCanonicalize(canonicalAdapter))}`;
}
