import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

import {
  jcsCanonicalize,
  sha256Hex,
  sha256Urn,
  techpubEntityId,
} from '../pure/canonical-hash';
import {
  PROFESSIONAL_INPUT_PURE_CONTRACT_ID,
  PROFESSIONAL_INPUT_PURE_CONTRACT_REVISION,
  PROFESSIONAL_INPUT_PURE_SCHEMA_ID,
  type StructuredParsePackage,
  type U0StrictValidationInput,
} from '../pure/professional-input-pure.types';
import { resolveHostedU0PythonRuntime } from '../../../runtime/u0-python/hosted-u0-python-runtime';
import type {
  S1000dAuthorizedSourceArtifact,
  S1000dPackageSourceArtifact,
} from '../../s1000d-ingress/s1000d-ingress.types';
import {
  parseS1000dXml,
  xmlAttribute,
  xmlChildren,
  xmlDescendants,
  xmlFirst,
  xmlText,
  type S1000dXmlElement,
} from '../../s1000d-ingress/s1000d-xml-parser';

export interface S1000dStructuredPackageBuildResult {
  pkg: StructuredParsePackage;
  u0Input: U0StrictValidationInput;
  documentIdentity: {
    documentCode: string;
    businessRevision: string | null;
  };
}

interface ParsedSource {
  binding: S1000dAuthorizedSourceArtifact;
  bytes: Uint8Array;
  root: S1000dXmlElement | null;
}

interface ModuleMetadata {
  type: 'dm' | 'pm' | 'dml' | 'ddn';
  source: ParsedSource;
  identity: string;
  issue: string;
  language: string;
  title: string;
  schemaName: string;
}

const ZERO_HASH = `sha256:${'0'.repeat(64)}`;
const ZERO_PACKAGE_ID = `urn:techpub:package:v1:sha256:${'0'.repeat(64)}`;
const DM_CODE_FIELDS = [
  'modelIdentCode',
  'systemDiffCode',
  'systemCode',
  'subSystemCode',
  'subSubSystemCode',
  'assyCode',
  'disassyCode',
  'disassyCodeVariant',
  'infoCode',
  'infoCodeVariant',
  'itemLocationCode',
] as const;

/**
 * Project actual XML/ICN/XSD bytes into the existing frozen.2 package model.
 * The function never reads a checked-in package or parser snapshot. Unsupported
 * document shapes fail closed before U0 rather than being flattened by a model.
 */
export async function buildS1000dXmlStructuredPackage(input: {
  artifacts: readonly S1000dPackageSourceArtifact[];
  generatedAt: string;
}): Promise<S1000dStructuredPackageBuildResult> {
  const parsedSources = parseAndBindSources(input.artifacts);
  const modules = parseModuleMetadata(parsedSources);
  const dm = requiredModule(modules, 'dm');
  const pm = requiredModule(modules, 'pm');
  const dml = requiredModule(modules, 'dml');
  const ddn = requiredModule(modules, 'ddn');
  assertLocalSchemaBindings([dm, pm, dml, ddn], parsedSources);

  const sourceArtifacts = parsedSources.map(({ binding }) => ({
    artifactId: binding.packageArtifactId,
    origin: 'source',
    role: binding.packageRole,
    artifactRef: `artifact://CanonicalArtifactStore/${encodeURIComponent(binding.hostSourceArtifactId)}`,
    sha256: `sha256:${binding.sha256}`,
    mediaType: binding.mediaType,
    byteLength: binding.byteLength,
    normalizedPath: binding.normalizedPath,
  }));
  const sourcePackageHash = hashValue(
    sourceArtifacts
      .map((artifact) => ({
        normalizedPath: artifact.normalizedPath,
        sha256: artifact.sha256,
        byteLength: artifact.byteLength,
        mediaType: artifact.mediaType,
      }))
      .sort((left, right) =>
        left.normalizedPath.localeCompare(right.normalizedPath),
      ),
  );
  const sourcePackageId = `s1000d:${dm.identity}`;
  const packageBase: Record<string, unknown> = {
    $schema: PROFESSIONAL_INPUT_PURE_SCHEMA_ID,
    schemaVersion: PROFESSIONAL_INPUT_PURE_CONTRACT_ID,
    contractRevision: PROFESSIONAL_INPUT_PURE_CONTRACT_REVISION,
    packageId: ZERO_PACKAGE_ID,
    integrity: {
      hashSpecVersion: 'techpub.hash.v1',
      canonicalization: 'RFC8785-JCS',
      digestAlgorithm: 'SHA-256',
      contentHash: ZERO_HASH,
      semanticHash: ZERO_HASH,
      provenanceHash: ZERO_HASH,
      coverageHash: ZERO_HASH,
    },
    result: {
      status: 'complete',
      accountingComplete: true,
      contentPreserved: true,
      structuredCoverageComplete: true,
    },
    artifacts: sourceArtifacts,
    source: {
      kind: 'native_s1000d',
      sourcePackageId,
      sourcePackageHash,
      identityAuthority: 'source_asserted',
      artifactIds: sourceArtifacts.map((artifact) => artifact.artifactId),
      deliveryObjects: [],
      legacyIdentifiers: [],
    },
    profile: {
      canonicalModel: 'technical-publication-core.v1',
      sourceProfile: `S1000D_${dm.issue.replace('.', '-')}`,
      sourceStandard: {
        name: 'S1000D',
        issue: dm.issue,
        profile: 'host-authorized-native-xml',
      },
      mappingProfile: {
        id: `s1000d-${dm.issue}-xml-to-techpub-core-v1`,
        version: 'frozen.2',
        hash: hashValue({
          id: `s1000d-${dm.issue}-xml-to-techpub-core-v1`,
          version: 'frozen.2',
          projection: 'DM+PM+DML+DDN+ICN',
        }),
      },
    },
    lineage: {
      generatedAt: input.generatedAt,
      producer: {
        name: 'WiseLinkS1000dXmlProducer',
        version: 's1000d-xml.v1.1',
        runtime: 'typescript',
        buildHash: sha256Urn('WiseLinkS1000dXmlProducer@s1000d-xml.v1.1'),
      },
      inputs: [
        {
          role: 'source_package',
          schemaVersion: `S1000D_${dm.issue.replace('.', '-')}`,
          id: sourcePackageId,
          hash: sourcePackageHash,
          artifactIds: sourceArtifacts.map((artifact) => artifact.artifactId),
        },
      ],
    },
    document: {},
    publicationStructures: [],
    modules: [],
    sourceRefs: [],
    sourceSegments: [],
    contentUnits: [],
    references: [],
    assets: [],
    applicability: {
      sourceExpressions: [],
      normalizedCandidates: [],
      assignments: [],
    },
    coverage: {
      basis: {
        segmentSetId: techpubEntityId('source-segment-set', '0'.repeat(64)),
        segmentSetHash: ZERO_HASH,
        segmentationProfileId: `s1000d-${dm.issue}-semantic-elements-v1`,
        segmentationProfileHash: hashValue({
          id: `s1000d-${dm.issue}-semantic-elements-v1`,
          version: 1,
        }),
        requiredSourceSegmentCount: 0,
      },
      entries: [],
      summary: {},
    },
    findings: [],
    extensions: [],
  };

  const refs = buildSourceRefs(parsedSources, { dm, pm, dml, ddn });
  (packageBase.sourceRefs as unknown[]) = [
    ...Object.entries(refs)
      .filter(([key]) => key !== 'schemas' && key !== 'tableData')
      .map(([, value]) => value as SourceRef),
    ...refs.schemas,
  ];

  const dmModule = moduleRecord(
    packageBase,
    dm,
    refs.dmMetadata,
    0,
    'data_module',
  );
  const pmModule = moduleRecord(packageBase, pm, refs.pmMetadata, 1, 'other');
  (packageBase.modules as unknown[]) = [dmModule, pmModule];
  const documentId = expectedDocumentId(packageBase);
  packageBase.document = {
    documentId,
    documentType: sourced('publication', refs.pmMetadata.sourceRefId, true),
    title: sourced(pm.title, refs.pmMetadata.sourceRefId),
    identifiers: [
      identifier(
        's1000d_pm_identity',
        pm.identity,
        refs.pmMetadata.sourceRefId,
      ),
    ],
    language: sourced(pm.language, refs.pmMetadata.sourceRefId),
    revision: {
      label: sourced(
        pm.identity.split(':').at(-2) ?? 'unknown',
        refs.pmMetadata.sourceRefId,
      ),
    },
    relationships: [],
  };

  const publicationId = stableId(
    'publication-structure',
    'techpub-publication-structure-id-v1',
    pm.identity,
  );
  const publicationNodeId = stableId(
    'publication-node',
    'techpub-publication-node-id-v1',
    {
      pm: pm.identity,
      title: refs.pmEntry.quote,
    },
  );
  packageBase.publicationStructures = [
    {
      publicationStructureId: publicationId,
      continuityKey: pm.identity,
      kind: 's1000d_publication_module',
      authority: 'source_asserted',
      order: 0,
      standardIdentity: identifier(
        's1000d_pm_identity',
        pm.identity,
        refs.pmMetadata.sourceRefId,
      ),
      title: sourced(pm.title, refs.pmMetadata.sourceRefId),
      sourceRefIds: [refs.pmMetadata.sourceRefId, refs.pmEntry.sourceRefId],
      nodes: [
        {
          nodeId: publicationNodeId,
          continuityKey: continuity(refs.pmEntry.quote),
          order: 0,
          title: sourced(refs.pmEntry.quote, refs.pmEntry.sourceRefId),
          moduleIds: [dmModule.moduleId],
          children: [],
        },
      ],
    },
  ];

  const dmlDelivery = deliveryObject(dml, refs.dmlMetadata);
  const ddnDelivery = deliveryObject(ddn, refs.ddnMetadata);
  (packageBase.source as Record<string, unknown>).deliveryObjects = [
    dmlDelivery,
    ddnDelivery,
  ];

  const contentUnits = buildContentUnits(packageBase, dmModule, pmModule, refs);
  packageBase.contentUnits = contentUnits;
  dmModule.contentUnitIds = contentUnits
    .filter((unit) => unit.moduleId === dmModule.moduleId)
    .map((unit) => unit.unitId);
  pmModule.contentUnitIds = contentUnits
    .filter((unit) => unit.moduleId === pmModule.moduleId)
    .map((unit) => unit.unitId);

  const referenceResult = buildReferences(contentUnits, refs, dmModule);
  packageBase.references = referenceResult.references;
  referenceResult.applyPayloads();
  packageBase.assets = buildAssets(
    parsedSources,
    contentUnits,
    refs,
    referenceResult,
  );
  packageBase.applicability = buildApplicability(dmModule.moduleId, refs);

  const coverage = buildCoverage(packageBase, refs, {
    dmModuleId: dmModule.moduleId,
    pmModuleId: pmModule.moduleId,
    documentId,
    publicationId,
    dmlDeliveryId: dmlDelivery.deliveryObjectId,
    ddnDeliveryId: ddnDelivery.deliveryObjectId,
  });
  packageBase.sourceSegments = coverage.segments;
  packageBase.coverage = coverage.coverage;
  for (const unit of contentUnits) unit.unitHash = expectedUnitHash(unit);

  const pkg = await finalizeWithFrozen2Runtime(packageBase);
  const bytes = new TextEncoder().encode(`${JSON.stringify(pkg)}\n`);
  const artifact = {
    storeRole: 'UnifiedArtifactStoreCandidate' as const,
    ref: `artifact://UnifiedArtifactStoreCandidate/unified-parsed-packages/sha256/${sha256Hex(bytes)}`,
    sha256: sha256Hex(bytes),
    byteLength: bytes.byteLength,
    mediaType: 'application/json' as const,
  };
  return {
    pkg,
    u0Input: { artifact, bytes, packageId: pkg.packageId },
    documentIdentity: {
      documentCode: dm.identity,
      businessRevision: dm.identity.split(':').at(-2) ?? null,
    },
  };
}

function parseAndBindSources(
  artifacts: readonly S1000dPackageSourceArtifact[],
): ParsedSource[] {
  if (artifacts.length === 0) throw buildError('SOURCE_SET_EMPTY');
  return [...artifacts]
    .sort((left, right) =>
      left.authorization.normalizedPath.localeCompare(
        right.authorization.normalizedPath,
      ),
    )
    .map(({ authorization: binding, actualBytes }) => {
      const actualHash = sha256Hex(actualBytes);
      if (
        actualBytes.byteLength !== binding.byteLength ||
        actualHash !== binding.sha256
      ) {
        throw buildError(`SOURCE_BYTE_MISMATCH:${binding.normalizedPath}`);
      }
      const xml = /(?:xml|xsd)$/iu.test(binding.normalizedPath);
      return {
        binding,
        bytes: Uint8Array.from(actualBytes),
        root: xml ? parseS1000dXml(actualBytes, binding.normalizedPath) : null,
      };
    });
}

function parseModuleMetadata(sources: ParsedSource[]): ModuleMetadata[] {
  const result: ModuleMetadata[] = [];
  for (const source of sources) {
    const root = source.root;
    if (!root || !['dmodule', 'pm', 'dml', 'ddn'].includes(root.localName)) {
      continue;
    }
    const type =
      root.localName === 'dmodule'
        ? 'dm'
        : (root.localName as ModuleMetadata['type']);
    const codeName = type === 'dm' ? 'dmCode' : `${type}Code`;
    const code = requiredElement(root, codeName, source.binding.normalizedPath);
    const language = requiredElement(
      root,
      'language',
      source.binding.normalizedPath,
    );
    const issue = requiredElement(
      root,
      'issueInfo',
      source.binding.normalizedPath,
    );
    const base =
      type === 'dm'
        ? identityFields(code, DM_CODE_FIELDS)
        : identityFields(code, Object.keys(code.attributes).sort());
    const languageValue = `${requiredAttribute(language, 'languageIsoCode')}-${requiredAttribute(language, 'countryIsoCode')}`;
    const issueValue = `${requiredAttribute(issue, 'issueNumber')}-${requiredAttribute(issue, 'inWork')}`;
    const title = moduleTitle(type, root) || `${type.toUpperCase()} ${base}`;
    const schemaLocation =
      xmlAttribute(root, 'noNamespaceSchemaLocation') ?? '';
    const schemaName = schemaLocation.split('/').at(-1) ?? '';
    const issueMatch = schemaLocation.match(/S1000D_(\d+)[-_](\d+)/u);
    if (!schemaName || !issueMatch)
      throw buildError(`SCHEMA_LOCATION:${source.binding.normalizedPath}`);
    result.push({
      type,
      source,
      identity: `${type}:-:${base}:${issueValue}:${languageValue}`,
      issue: `${issueMatch[1]}.${issueMatch[2]}`,
      language: languageValue,
      title,
      schemaName,
    });
  }
  if (new Set(result.map((item) => item.type)).size !== result.length) {
    throw buildError('DUPLICATE_MODULE_TYPE');
  }
  return result;
}

function assertLocalSchemaBindings(
  modules: ModuleMetadata[],
  sources: ParsedSource[],
): void {
  const issues = new Set(modules.map((item) => item.issue));
  if (issues.size !== 1) throw buildError('MIXED_S1000D_ISSUE');
  for (const module of modules) {
    const schema = sources.find(
      (item) =>
        item.binding.packageRole === 'schema' &&
        item.binding.normalizedPath.split('/').at(-1) === module.schemaName,
    );
    const declared = schema?.root
      ? xmlDescendants(schema.root, 'element').some(
          (element) =>
            xmlAttribute(element, 'name') === module.source.root?.localName,
        )
      : false;
    if (!schema || !declared) {
      throw buildError(
        `LOCAL_SCHEMA_BINDING:${module.source.binding.normalizedPath}`,
      );
    }
  }
}

function buildSourceRefs(
  sources: ParsedSource[],
  modules: Record<'dm' | 'pm' | 'dml' | 'ddn', ModuleMetadata>,
) {
  const byPath = new Map(
    sources.map((source) => [source.binding.normalizedPath, source]),
  );
  const dmPath = modules.dm.source.binding.normalizedPath;
  const pmPath = modules.pm.source.binding.normalizedPath;
  const dmlPath = modules.dml.source.binding.normalizedPath;
  const ddnPath = modules.ddn.source.binding.normalizedPath;
  const ref = (
    path: string,
    xpath: string,
    quote: string,
    elementId?: string,
  ) => {
    const source = byPath.get(path);
    if (!source) throw buildError(`SOURCE_REF_PATH:${path}`);
    const value: Record<string, unknown> = {
      sourceRefId: techpubEntityId('source-ref', '0'.repeat(64)),
      kind: 'xml',
      artifactId: source.binding.packageArtifactId,
      normalizedPath: path,
      xpath,
      ...(elementId ? { elementId } : {}),
      quote,
      anchorTextHash: sha256Urn(quote),
    };
    value.sourceRefId = expectedSourceRefId(value);
    return value as SourceRef;
  };
  const dmRoot = modules.dm.source.root as S1000dXmlElement;
  const pmRoot = modules.pm.source.root as S1000dXmlElement;
  const title = requiredElement(dmRoot, 'title', dmPath);
  const paragraph = requiredElement(dmRoot, 'para', dmPath);
  const step = requiredElement(dmRoot, 'proceduralStep', dmPath);
  const warning = requiredElement(step, 'warning', dmPath);
  const caution = requiredElement(step, 'caution', dmPath);
  const note = requiredElement(step, 'note', dmPath);
  const list = requiredElement(step, 'randomList', dmPath);
  const listItem = requiredElement(list, 'listItem', dmPath);
  const table = requiredElement(step, 'table', dmPath);
  const figure = requiredElement(step, 'figure', dmPath);
  const graphic = requiredElement(figure, 'graphic', dmPath);
  const internal = requiredElement(step, 'internalRef', dmPath);
  const external = requiredElement(step, 'externalPubRef', dmPath);
  const applicability = requiredElement(dmRoot, 'applic', dmPath);
  const pmEntry = requiredElement(pmRoot, 'pmEntry', pmPath);
  const pmDmRef = requiredElement(pmEntry, 'dmRef', pmPath);
  const result = {
    dmMetadata: ref(
      dmPath,
      '/dmodule/identAndStatusSection/dmAddress',
      modules.dm.title,
    ),
    pmMetadata: ref(
      pmPath,
      '/pm/identAndStatusSection/pmAddress',
      modules.pm.title,
    ),
    dmlMetadata: ref(dmlPath, '/dml', modules.dml.identity),
    ddnMetadata: ref(ddnPath, '/ddn', modules.ddn.identity),
    heading: ref(
      dmPath,
      '/dmodule/content/description/levelledPara/title',
      xmlText(title),
    ),
    paragraph: ref(
      dmPath,
      '/dmodule/content/description/levelledPara/para',
      directText(paragraph),
    ),
    step: ref(
      dmPath,
      '/dmodule/content/procedure/mainProcedure/proceduralStep',
      directText(step),
      xmlAttribute(step, 'id') ?? undefined,
    ),
    warning: ref(
      dmPath,
      '/dmodule/content/procedure/mainProcedure/proceduralStep/warning',
      xmlText(warning),
      xmlAttribute(warning, 'id') ?? undefined,
    ),
    caution: ref(
      dmPath,
      '/dmodule/content/procedure/mainProcedure/proceduralStep/caution',
      xmlText(caution),
      xmlAttribute(caution, 'id') ?? undefined,
    ),
    note: ref(
      dmPath,
      '/dmodule/content/procedure/mainProcedure/proceduralStep/note',
      xmlText(note),
      xmlAttribute(note, 'id') ?? undefined,
    ),
    list: ref(
      dmPath,
      '/dmodule/content/procedure/mainProcedure/proceduralStep/randomList',
      xmlText(list),
    ),
    listItem: ref(
      dmPath,
      '/dmodule/content/procedure/mainProcedure/proceduralStep/randomList/listItem',
      xmlText(listItem),
    ),
    table: ref(
      dmPath,
      '/dmodule/content/procedure/mainProcedure/proceduralStep/table',
      xmlText(table),
      xmlAttribute(table, 'id') ?? undefined,
    ),
    figure: ref(
      dmPath,
      '/dmodule/content/procedure/mainProcedure/proceduralStep/figure',
      xmlText(requiredElement(figure, 'title', dmPath)),
      xmlAttribute(figure, 'id') ?? undefined,
    ),
    graphic: ref(
      dmPath,
      '/dmodule/content/procedure/mainProcedure/proceduralStep/figure/graphic',
      requiredAttribute(graphic, 'infoEntityIdent'),
      xmlAttribute(graphic, 'id') ?? undefined,
    ),
    internal: ref(
      dmPath,
      '/dmodule/content/procedure/mainProcedure/proceduralStep/internalRef',
      requiredAttribute(internal, 'internalRefId'),
    ),
    external: ref(
      dmPath,
      '/dmodule/content/procedure/mainProcedure/proceduralStep/externalPubRef',
      xmlText(external),
    ),
    applicability: ref(
      dmPath,
      '/dmodule/identAndStatusSection/dmStatus/applic',
      xmlText(requiredElement(applicability, 'displayText', dmPath)),
      xmlAttribute(applicability, 'id') ?? undefined,
    ),
    pmEntry: ref(
      pmPath,
      '/pm/content/pmEntry',
      xmlText(requiredElement(pmEntry, 'pmEntryTitle', pmPath)),
    ),
    pmDmRef: ref(
      pmPath,
      '/pm/content/pmEntry/dmRef',
      dmCodeValue(requiredElement(pmDmRef, 'dmCode', pmPath)),
    ),
    tableData: {
      caption: xmlText(requiredElement(table, 'title', dmPath)),
      rows: xmlDescendants(table, 'row').map((row) =>
        xmlChildren(row, 'entry').map(xmlText),
      ),
    },
    schemas: sources
      .filter((source) => source.binding.packageRole === 'schema')
      .map((source) =>
        ref(source.binding.normalizedPath, '/xs:schema', '<xs:schema'),
      ),
  };
  return result;
}

type SourceRef = {
  sourceRefId: string;
  kind: 'xml';
  artifactId: string;
  normalizedPath: string;
  xpath: string;
  elementId?: string;
  quote: string;
  anchorTextHash: string;
};

type SourceRefs = ReturnType<typeof buildSourceRefs>;

function moduleRecord(
  pkg: Record<string, unknown>,
  metadata: ModuleMetadata,
  ref: SourceRef,
  order: number,
  moduleKind: 'data_module' | 'other',
) {
  const result = {
    moduleId: techpubEntityId('module', '0'.repeat(64)),
    continuityKey: metadata.identity,
    moduleKind,
    informationType: metadata.type === 'dm' ? 'procedural' : 'publication',
    authority: 'source_asserted',
    identityStability: 'source_stable',
    order,
    standardIdentity: identifier(
      `s1000d_${metadata.type}_identity`,
      metadata.identity,
      ref.sourceRefId,
    ),
    title: sourced(metadata.title, ref.sourceRefId),
    sourceRefIds: [ref.sourceRefId],
    contentUnitIds: [] as string[],
  };
  result.moduleId = expectedModuleId(pkg, result);
  return result;
}

function buildContentUnits(
  pkg: Record<string, unknown>,
  dmModule: ReturnType<typeof moduleRecord>,
  pmModule: ReturnType<typeof moduleRecord>,
  refs: SourceRefs,
) {
  const units: Array<Record<string, any>> = [];
  const add = (
    module: ReturnType<typeof moduleRecord>,
    input: {
      continuityKey: string;
      kind: string;
      order: number;
      depth: number;
      ref: SourceRef;
      payload: Record<string, unknown>;
      parentUnitId?: string;
      normalized?: boolean;
    },
  ) => {
    const unit: Record<string, any> = {
      unitId: techpubEntityId('unit', '0'.repeat(64)),
      continuityKey: input.continuityKey,
      unitHash: ZERO_HASH,
      moduleId: module.moduleId,
      kind: input.kind,
      identityStability: 'source_stable',
      order: input.order,
      depth: input.depth,
      ...(input.parentUnitId ? { parentUnitId: input.parentUnitId } : {}),
      sourceRefIds: [input.ref.sourceRefId],
      sourceSegmentIds: [] as string[],
      mapping: {
        status: input.normalized
          ? 'mapped_with_normalization'
          : 'mapped_exactly',
        confidence: 'deterministic',
        findingIds: [],
      },
      payload: input.payload,
    };
    unit.unitId = expectedUnitId(pkg, module, unit);
    units.push(unit);
    return unit;
  };
  const heading = add(dmModule, {
    continuityKey: `description/${continuity(refs.heading.quote)}`,
    kind: 'heading',
    order: 0,
    depth: 0,
    ref: refs.heading,
    payload: { text: refs.heading.quote, level: 1 },
  });
  add(dmModule, {
    continuityKey: `${heading.continuityKey}/paragraph-1`,
    kind: 'paragraph',
    order: 0,
    depth: 1,
    parentUnitId: heading.unitId,
    ref: refs.paragraph,
    payload: { text: refs.paragraph.quote, role: 'body' },
  });
  const step = add(dmModule, {
    continuityKey: refs.step.elementId ?? `step/${continuity(refs.step.quote)}`,
    kind: 'step',
    order: 1,
    depth: 0,
    ref: refs.step,
    payload: {
      stepRole: 'procedural',
      label: '1',
      instructionText: refs.step.quote,
    },
    normalized: true,
  });
  for (const [order, ref, advisoryType] of [
    [0, refs.warning, 'warning'],
    [1, refs.caution, 'caution'],
    [2, refs.note, 'note'],
  ] as const) {
    add(dmModule, {
      continuityKey: ref.elementId ?? `${step.continuityKey}/${advisoryType}`,
      kind: 'advisory',
      order,
      depth: 1,
      parentUnitId: step.unitId,
      ref,
      payload: {
        advisoryType,
        text: ref.quote,
        scope: { kind: 'explicit_units', targetUnitIds: [step.unitId] },
      },
    });
  }
  const list = add(dmModule, {
    continuityKey: `${step.continuityKey}/list-1`,
    kind: 'list',
    order: 3,
    depth: 1,
    parentUnitId: step.unitId,
    ref: refs.list,
    payload: { listType: 'unordered', itemUnitIds: [] },
  });
  const listItem = add(dmModule, {
    continuityKey: `${list.continuityKey}/item-1`,
    kind: 'list_item',
    order: 0,
    depth: 2,
    parentUnitId: list.unitId,
    ref: refs.listItem,
    payload: { marker: '•', text: refs.listItem.quote },
  });
  list.payload.itemUnitIds = [listItem.unitId];
  const table = add(dmModule, {
    continuityKey: refs.table.elementId ?? `${step.continuityKey}/table-1`,
    kind: 'table',
    order: 4,
    depth: 1,
    parentUnitId: step.unitId,
    ref: refs.table,
    payload: tablePayload(refs.table, refs.tableData),
  });
  const figure = add(dmModule, {
    continuityKey: refs.figure.elementId ?? `${step.continuityKey}/figure-1`,
    kind: 'figure',
    order: 5,
    depth: 1,
    parentUnitId: step.unitId,
    ref: refs.figure,
    payload: {
      figureId: stableId(
        'figure',
        'techpub-figure-id-v1',
        refs.figure.sourceRefId,
      ),
      caption: refs.figure.quote,
      assetIds: [] as string[],
      referenceIds: [] as string[],
    },
  });
  const referenceUnit = add(dmModule, {
    continuityKey: `${step.continuityKey}/references`,
    kind: 'reference',
    order: 6,
    depth: 1,
    parentUnitId: step.unitId,
    ref: refs.internal,
    payload: { referenceIds: [] as string[] },
  });
  referenceUnit.sourceRefIds = [
    refs.internal.sourceRefId,
    refs.external.sourceRefId,
  ];
  const pmHeading = add(pmModule, {
    continuityKey: `${continuity(refs.pmEntry.quote)}/title`,
    kind: 'heading',
    order: 0,
    depth: 0,
    ref: refs.pmEntry,
    payload: { text: refs.pmEntry.quote, level: 1 },
  });
  add(pmModule, {
    continuityKey: `${continuity(refs.pmEntry.quote)}/dm-ref`,
    kind: 'reference',
    order: 0,
    depth: 1,
    parentUnitId: pmHeading.unitId,
    ref: refs.pmDmRef,
    payload: { referenceIds: [] as string[] },
  });
  void table;
  void figure;
  return units;
}

function tablePayload(
  ref: SourceRef,
  data: { caption: string; rows: string[][] },
): Record<string, unknown> {
  const seed = ref.sourceRefId;
  if (
    data.rows.length === 0 ||
    data.rows.some(
      (row) => row.length === 0 || row.length !== data.rows[0].length,
    )
  ) {
    throw buildError('TABLE_GRID_UNSUPPORTED');
  }
  const columnCount = data.rows[0].length;
  return {
    layout: 'grid',
    caption: data.caption,
    columnCount,
    columns: data.rows[0].map((name, order) => ({
      columnId: stableId('table-column', 'techpub-table-column-id-v1', {
        seed,
        order,
      }),
      order,
      name: continuity(name),
      width: '1*',
      align: 'left',
      sourceRefIds: [seed],
    })),
    rowGroups: [
      {
        rowGroupId: stableId(
          'table-row-group',
          'techpub-table-row-group-id-v1',
          seed,
        ),
        kind: 'tbody',
        order: 0,
        rows: data.rows.map((row, rowOrder) => ({
          rowId: stableId('table-row', 'techpub-table-row-id-v1', {
            seed,
            rowOrder,
          }),
          order: rowOrder,
          cells: row.map((text, cellOrder) => ({
            cellId: stableId('table-cell', 'techpub-table-cell-id-v1', {
              seed,
              rowOrder,
              cellOrder,
            }),
            order: cellOrder,
            columnStart: cellOrder,
            rowSpan: 1,
            colSpan: 1,
            role: rowOrder === 0 ? 'header' : 'data',
            inlineContent: [
              {
                inlineId: stableId('inline', 'techpub-inline-id-v1', {
                  seed,
                  rowOrder,
                  cellOrder,
                }),
                kind: 'text',
                text,
                sourceRefIds: [seed],
              },
            ],
            sourceRefIds: [seed],
          })),
          sourceRefIds: [seed],
        })),
      },
    ],
  };
}

function buildReferences(
  units: Array<Record<string, any>>,
  refs: SourceRefs,
  dmModule: ReturnType<typeof moduleRecord>,
) {
  const step = units.find((unit) => unit.kind === 'step') as Record<
    string,
    any
  >;
  const figure = units.find((unit) => unit.kind === 'figure') as Record<
    string,
    any
  >;
  const referenceUnits = units.filter((unit) => unit.kind === 'reference');
  const dmReferenceUnit = referenceUnits[0];
  const pmReferenceUnit = referenceUnits[1];
  const assetId = stableId('asset', 'techpub-asset-id-v1', refs.graphic.quote);
  const make = (
    referenceType: string,
    fromUnitId: string,
    targetKind: string,
    scheme: string,
    value: string,
    resolutionStatus: string,
    ref: SourceRef,
    authority: 'source_asserted' | 'parser_normalized',
  ) => {
    const target = {
      kind: targetKind,
      identifier: {
        scheme,
        value,
        completeness: resolutionStatus === 'external' ? 'partial' : 'complete',
        ...(resolutionStatus === 'external'
          ? { missingComponents: ['revision'] }
          : {}),
      },
    };
    return {
      referenceId: stableId('reference', 'techpub-reference-id-v1', {
        referenceType,
        fromUnitId,
        target,
        resolutionStatus,
        sourceRefIds: [ref.sourceRefId],
      }),
      referenceType,
      fromUnitId,
      target,
      resolutionStatus,
      authority,
      sourceRefIds: [ref.sourceRefId],
      findingIds: [],
    };
  };
  const internal = make(
    'internal_anchor',
    dmReferenceUnit.unitId,
    'unit',
    'techpub_core_unit_id',
    step.unitId,
    'resolved',
    refs.internal,
    'parser_normalized',
  );
  const external = make(
    'external_reference',
    dmReferenceUnit.unitId,
    'external',
    'external_publication_code',
    refs.external.quote,
    'external',
    refs.external,
    'source_asserted',
  );
  const asset = make(
    'asset_reference',
    figure.unitId,
    'asset',
    'techpub_core_asset_id',
    assetId,
    'resolved',
    refs.graphic,
    'parser_normalized',
  );
  const module = make(
    'module_reference',
    pmReferenceUnit.unitId,
    'module',
    'techpub_core_module_id',
    dmModule.moduleId,
    'resolved',
    refs.pmDmRef,
    'parser_normalized',
  );
  return {
    references: [internal, external, asset, module],
    assetId,
    assetReferenceId: asset.referenceId,
    applyPayloads: () => {
      dmReferenceUnit.payload.referenceIds = [
        internal.referenceId,
        external.referenceId,
      ];
      figure.payload.assetIds = [assetId];
      figure.payload.referenceIds = [asset.referenceId];
      pmReferenceUnit.payload.referenceIds = [module.referenceId];
    },
  };
}

function buildAssets(
  sources: ParsedSource[],
  units: Array<Record<string, any>>,
  refs: SourceRefs,
  referenceResult: ReturnType<typeof buildReferences>,
) {
  const source = sources.find(
    (item) =>
      item.binding.packageRole === 'information_entity' &&
      item.binding.normalizedPath.includes(refs.graphic.quote),
  );
  if (!source) throw buildError('INFORMATION_ENTITY_MISSING');
  const figure = units.find((unit) => unit.kind === 'figure') as Record<
    string,
    any
  >;
  return [
    {
      assetId: referenceResult.assetId,
      logicalType: 's1000d_information_entity',
      authority: 'source_asserted',
      standardIdentity: identifier(
        's1000d_icn',
        refs.graphic.quote,
        refs.graphic.sourceRefId,
      ),
      title: sourced(refs.figure.quote, refs.figure.sourceRefId),
      sourceRefIds: [refs.graphic.sourceRefId],
      renditions: [
        {
          renditionId: stableId('rendition', 'techpub-rendition-id-v1', {
            assetId: referenceResult.assetId,
            artifactId: source.binding.packageArtifactId,
          }),
          role: 'source_original',
          artifactId: source.binding.packageArtifactId,
          mediaType: source.binding.mediaType,
          sha256: `sha256:${source.binding.sha256}`,
          pixelWidth: 1,
          pixelHeight: 1,
          sourceRefIds: [refs.graphic.sourceRefId],
        },
      ],
    },
  ].map((asset) => {
    void figure;
    return asset;
  });
}

function buildApplicability(moduleId: string, refs: SourceRefs) {
  const expressionId = stableId(
    'applicability-source',
    'techpub-applicability-source-id-v1',
    {
      text: refs.applicability.quote,
      sourceRefIds: [refs.applicability.sourceRefId],
    },
  );
  const assignmentTarget = {
    kind: 'module',
    targetId: moduleId,
    sourceRefIds: [refs.applicability.sourceRefId],
  };
  return {
    sourceExpressions: [
      {
        expressionId,
        text: refs.applicability.quote,
        form: 'display_text',
        authority: 'source_asserted',
        sourceRefIds: [refs.applicability.sourceRefId],
      },
    ],
    // No ACT/CCT/PCT authority exists in this input. The source expression is
    // preserved, but it is not normalized into an aircraft installation fact.
    normalizedCandidates: [],
    assignments: [
      {
        assignmentId: stableId(
          'applicability-assignment',
          'techpub-applicability-assignment-id-v1',
          {
            expressionId,
            target: assignmentTarget,
          },
        ),
        expressionId,
        target: assignmentTarget,
        ...(refs.applicability.elementId
          ? { sourceReferenceId: refs.applicability.elementId }
          : {}),
        authority: 'source_asserted',
      },
    ],
  };
}

function buildCoverage(
  pkg: Record<string, unknown>,
  refs: SourceRefs,
  targets: Record<string, string>,
) {
  const unitByRef = new Map<string, string>();
  for (const unit of pkg.contentUnits as Array<Record<string, any>>) {
    for (const sourceRefId of unit.sourceRefIds as string[]) {
      unitByRef.set(sourceRefId, unit.unitId as string);
    }
  }
  const refSpecs: Array<{
    key: string;
    semantic: string;
    ref: SourceRef;
    targetIds: string[];
    excluded?: boolean;
  }> = [
    ...refs.schemas.map((ref) => ({
      key: `schema:${ref.normalizedPath}`,
      semantic: 'other',
      ref,
      targetIds: [],
      excluded: true,
    })),
    {
      key: 'dm-metadata',
      semantic: 'metadata',
      ref: refs.dmMetadata,
      targetIds: [targets.dmModuleId],
    },
    {
      key: 'pm-metadata',
      semantic: 'metadata',
      ref: refs.pmMetadata,
      targetIds: [
        targets.documentId,
        targets.pmModuleId,
        targets.publicationId,
      ],
    },
    {
      key: 'dml-delivery-object',
      semantic: 'other',
      ref: refs.dmlMetadata,
      targetIds: [targets.dmlDeliveryId],
    },
    {
      key: 'ddn-delivery-object',
      semantic: 'other',
      ref: refs.ddnMetadata,
      targetIds: [targets.ddnDeliveryId],
    },
    ...Object.entries(refs)
      .filter(
        ([key, value]) =>
          key !== 'schemas' &&
          key !== 'tableData' &&
          !['dmMetadata', 'pmMetadata', 'dmlMetadata', 'ddnMetadata'].includes(
            key,
          ) &&
          !Array.isArray(value),
      )
      .map(([key, value]) => {
        const ref = value as SourceRef;
        return {
          key,
          semantic: semanticForRef(key),
          ref,
          targetIds: coverageTargetIds(pkg, key, ref, unitByRef),
        };
      }),
  ];
  const segments = refSpecs.map((spec, order) => {
    const segment: Record<string, any> = {
      sourceSegmentId: techpubEntityId('source-segment', '0'.repeat(64)),
      continuityKey: spec.key,
      kind: 'xml_element',
      expectedSemantic: spec.semantic,
      order,
      sourceRefIds: [spec.ref.sourceRefId],
      segmentHash: hashValue({
        kind: 'xml_element',
        expectedSemantic: spec.semantic,
        sourceRefIds: [spec.ref.sourceRefId],
      }),
      coverageRequired: true,
    };
    segment.sourceSegmentId = expectedSourceSegmentId(pkg, segment);
    return segment;
  });
  const segmentByRef = new Map(
    segments.map((segment) => [
      segment.sourceRefIds[0] as string,
      segment.sourceSegmentId as string,
    ]),
  );
  for (const unit of pkg.contentUnits as Array<Record<string, any>>) {
    unit.sourceSegmentIds = (unit.sourceRefIds as string[])
      .map((sourceRefId) => segmentByRef.get(sourceRefId))
      .filter(Boolean);
  }
  const entries = refSpecs.map((spec, index) => ({
    sourceSegmentId: segments[index].sourceSegmentId,
    disposition: spec.excluded
      ? 'intentionally_excluded_with_reason'
      : 'mapped_exactly',
    targetIds: spec.targetIds,
    findingIds: [],
    ...(spec.excluded ? { reasonCode: 'schema_definition' } : {}),
  }));
  const segmentSetView = segments
    .map((segment) => ({
      sourceSegmentId: segment.sourceSegmentId,
      segmentHash: segment.segmentHash,
      coverageRequired: segment.coverageRequired,
    }))
    .sort((left, right) =>
      left.sourceSegmentId.localeCompare(right.sourceSegmentId),
    );
  const segmentSetHash = hashValue(segmentSetView);
  const excluded = refSpecs.filter((spec) => spec.excluded).length;
  return {
    segments,
    coverage: {
      basis: {
        segmentSetId: techpubEntityId(
          'source-segment-set',
          segmentSetHash.slice(7),
        ),
        segmentSetHash,
        segmentationProfileId: (pkg.coverage as Record<string, any>).basis
          .segmentationProfileId,
        segmentationProfileHash: (pkg.coverage as Record<string, any>).basis
          .segmentationProfileHash,
        requiredSourceSegmentCount: segments.length,
      },
      entries,
      summary: {
        requiredSourceSegmentCount: entries.length,
        mappedExactlyCount: entries.length - excluded,
        mappedWithNormalizationCount: 0,
        preservedAsTextCount: 0,
        intentionallyExcludedCount: excluded,
        blockedCount: 0,
        accountingComplete: true,
        contentPreserved: true,
        structuredCoverageComplete: true,
      },
    },
  };
}

function semanticForRef(key: string): string {
  if (key === 'heading' || key === 'pmEntry') return 'heading';
  if (key === 'paragraph') return 'text';
  if (key === 'step') return 'step';
  if (['warning', 'caution', 'note'].includes(key)) return 'advisory';
  if (key === 'list' || key === 'listItem') return 'list';
  if (key === 'table') return 'table';
  if (key === 'figure') return 'figure';
  if (key === 'graphic') return 'asset';
  if (key === 'applicability') return 'applicability';
  return 'reference';
}

function coverageTargetIds(
  pkg: Record<string, unknown>,
  key: string,
  ref: SourceRef,
  unitByRef: ReadonlyMap<string, string>,
): string[] {
  const unitId = unitByRef.get(ref.sourceRefId);
  if (unitId) return [unitId];
  if (key === 'graphic') {
    const assetId = (pkg.assets as Array<Record<string, unknown>>)[0]?.assetId;
    return typeof assetId === 'string' ? [assetId] : [];
  }
  if (key === 'applicability') {
    const applicability = pkg.applicability as Record<string, any>;
    return [
      applicability.sourceExpressions?.[0]?.expressionId,
      applicability.assignments?.[0]?.assignmentId,
    ].filter((value): value is string => typeof value === 'string');
  }
  return [];
}

function deliveryObject(metadata: ModuleMetadata, ref: SourceRef) {
  return {
    deliveryObjectId: stableId(
      'delivery-object',
      'techpub-delivery-object-id-v1',
      metadata.identity,
    ),
    kind: metadata.type,
    identifier: identifier(
      `s1000d_${metadata.type}_identity`,
      metadata.identity,
      ref.sourceRefId,
    ),
    artifactIds: [metadata.source.binding.packageArtifactId],
    sourceRefIds: [ref.sourceRefId],
  };
}

function expectedDocumentId(pkg: Record<string, unknown>): string {
  return stableId('document', 'techpub-document-id-v1', undefined, {
    sourcePackageId: (pkg.source as Record<string, unknown>).sourcePackageId,
  });
}

function expectedModuleId(
  pkg: Record<string, unknown>,
  module: Record<string, unknown>,
): string {
  return stableId('module', 'techpub-module-id-v1', undefined, {
    sourcePackageId: (pkg.source as Record<string, unknown>).sourcePackageId,
    continuityKey: module.continuityKey,
    moduleKind: module.moduleKind,
  });
}

function expectedUnitId(
  pkg: Record<string, unknown>,
  module: Record<string, unknown>,
  unit: Record<string, unknown>,
): string {
  return stableId('unit', 'techpub-unit-id-v1', undefined, {
    sourcePackageId: (pkg.source as Record<string, unknown>).sourcePackageId,
    moduleAnchorKey: module.continuityKey,
    sourceAnchorKey: unit.continuityKey,
    kind: unit.kind,
  });
}

function expectedSourceRefId(ref: Record<string, unknown>): string {
  return stableId(
    'source-ref',
    'techpub-source-ref-id-v1',
    undefined,
    Object.fromEntries(
      Object.entries(ref).filter(([key]) => key !== 'sourceRefId'),
    ),
  );
}

function expectedSourceSegmentId(
  pkg: Record<string, unknown>,
  segment: Record<string, unknown>,
): string {
  return stableId('source-segment', 'techpub-source-segment-id-v1', undefined, {
    sourcePackageId: (pkg.source as Record<string, unknown>).sourcePackageId,
    continuityKey: segment.continuityKey,
    kind: segment.kind,
  });
}

function expectedUnitHash(unit: Record<string, unknown>): string {
  return hashValue(
    Object.fromEntries(
      Object.entries(unit).filter(([key]) => key !== 'unitHash'),
    ),
  );
}

function stableId(
  kind: string,
  namespace: string,
  value?: unknown,
  extra: Record<string, unknown> = {},
): string {
  return techpubEntityId(
    kind,
    sha256Hex(
      jcsCanonicalize({
        namespace,
        ...(value === undefined ? extra : { value }),
      }),
    ),
  );
}

function hashValue(value: unknown): string {
  return sha256Urn(jcsCanonicalize(value));
}

function sourced(value: string, sourceRefId: string, normalized = false) {
  return {
    value,
    authority: normalized ? 'parser_normalized' : 'source_asserted',
    mappingStatus: normalized ? 'normalized' : 'exact',
    sourceRefIds: [sourceRefId],
  };
}

function identifier(scheme: string, value: string, sourceRefId: string) {
  return {
    scheme,
    value,
    authority: 'source_asserted',
    completeness: 'complete',
    sourceRefIds: [sourceRefId],
  };
}

function requiredModule(
  modules: ModuleMetadata[],
  type: ModuleMetadata['type'],
): ModuleMetadata {
  const value = modules.find((item) => item.type === type);
  if (!value) throw buildError(`MODULE_REQUIRED:${type}`);
  return value;
}

function requiredElement(
  root: S1000dXmlElement,
  name: string,
  path: string,
): S1000dXmlElement {
  const value = root.localName === name ? root : xmlFirst(root, name);
  if (!value) throw buildError(`ELEMENT_REQUIRED:${path}:${name}`);
  return value;
}

function requiredAttribute(element: S1000dXmlElement, name: string): string {
  const value = xmlAttribute(element, name)?.trim();
  if (!value)
    throw buildError(`ATTRIBUTE_REQUIRED:${element.localName}:${name}`);
  return value;
}

function identityFields(
  element: S1000dXmlElement,
  fields: readonly string[],
): string {
  return fields
    .map((field) => `${field}=${requiredAttribute(element, field)}`)
    .join(';');
}

function dmCodeValue(code: S1000dXmlElement): string {
  return `dm:-:${identityFields(code, DM_CODE_FIELDS)}`;
}

function moduleTitle(
  type: ModuleMetadata['type'],
  root: S1000dXmlElement,
): string {
  if (type === 'dm') {
    return [xmlFirst(root, 'techName'), xmlFirst(root, 'infoName')]
      .filter((value): value is S1000dXmlElement => value !== null)
      .map(xmlText)
      .join(' ')
      .trim();
  }
  if (type === 'pm') return xmlText(xmlFirst(root, 'pmTitle') ?? root);
  return '';
}

function directText(element: S1000dXmlElement): string {
  const direct = element.text.replace(/\s+/gu, ' ').trim();
  if (direct) return direct;
  const paragraph = xmlChildren(element, 'para')[0];
  return paragraph ? xmlText(paragraph) : xmlText(element);
}

function continuity(value: string): string {
  const normalized = value
    .normalize('NFC')
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '');
  return normalized || sha256Hex(value).slice(0, 16);
}

function buildError(
  reason: string,
): Error & { code: string; statusCode: number } {
  return Object.assign(
    new Error(`S1000D XML projection rejected (${reason}).`),
    {
      code: 'S1000D_XML_PROJECTION_REJECTED',
      statusCode: 409,
    },
  );
}

async function finalizeWithFrozen2Runtime(
  packageBase: Record<string, unknown>,
): Promise<StructuredParsePackage> {
  const runtime = await frozen2Runtime();
  const contractRoot = resolve(
    __dirname,
    '../../../runtime-assets/technical-publication-parsed-package/v1-frozen-2',
  );
  const code = [
    'import json,sys',
    'from pathlib import Path',
    'root=Path(sys.argv[1])',
    'sys.path.insert(0,str(root))',
    'from scripts.contract_core import refresh_integrity',
    'value=json.load(sys.stdin)',
    'refresh_integrity(value)',
    'print(json.dumps(value,ensure_ascii=False,separators=(",",":")))',
  ].join(';');
  const stdout = await runFrozen2Python({
    executable: runtime.executable,
    args: [...runtime.prefixArgs, '-c', code, contractRoot],
    env: runtime.env,
    input: JSON.stringify(packageBase),
  });
  try {
    return JSON.parse(stdout) as StructuredParsePackage;
  } catch {
    throw finalizerUnavailable('INVALID_OUTPUT');
  }
}

async function frozen2Runtime(): Promise<{
  executable: string;
  prefixArgs: string[];
  env: NodeJS.ProcessEnv;
}> {
  const local =
    process.env.WL_TEST_U0_PYTHON?.trim() ||
    (process.env.NODE_ENV === 'development' &&
    process.env.MIAODA_LOCAL_DEV === '1'
      ? process.env.WL_LOCAL_U0_PYTHON?.trim()
      : '');
  if (process.env.NODE_ENV === 'test' || local) {
    return {
      executable: local || 'python3',
      prefixArgs: [],
      env: { ...process.env },
    };
  }
  try {
    const hosted = await resolveHostedU0PythonRuntime();
    return {
      executable: hosted.pythonExecutable,
      prefixArgs: ['-S'],
      env: {
        ...process.env,
        PYTHONPATH: hosted.pythonModulePath,
        PYTHONNOUSERSITE: '1',
      },
    };
  } catch {
    throw finalizerUnavailable('RUNTIME');
  }
}

function runFrozen2Python(input: {
  executable: string;
  args: string[];
  env: NodeJS.ProcessEnv;
  input: string;
}): Promise<string> {
  return new Promise((resolveOutput, reject) => {
    const child = spawn(input.executable, input.args, {
      env: input.env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let outputLength = 0;
    const timeout = setTimeout(() => {
      child.kill('SIGKILL');
      reject(finalizerUnavailable('TIMEOUT'));
    }, 30_000);
    child.stdout.on('data', (chunk: Buffer) => {
      outputLength += chunk.byteLength;
      if (outputLength > 32 * 1024 * 1024) {
        child.kill('SIGKILL');
        reject(finalizerUnavailable('OUTPUT_LIMIT'));
        return;
      }
      stdout.push(chunk);
    });
    child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));
    child.once('error', () => {
      clearTimeout(timeout);
      reject(finalizerUnavailable('PROCESS'));
    });
    child.once('close', (code) => {
      clearTimeout(timeout);
      if (code !== 0) {
        void stderr;
        reject(finalizerUnavailable('PROCESS'));
        return;
      }
      resolveOutput(Buffer.concat(stdout).toString('utf8'));
    });
    child.stdin.end(input.input, 'utf8');
  });
}

function finalizerUnavailable(reason: string): Error & {
  code: string;
  statusCode: number;
} {
  return Object.assign(
    new Error(`The frozen.2 package finalizer is unavailable (${reason}).`),
    {
      code: 'S1000D_FROZEN2_FINALIZER_UNAVAILABLE',
      statusCode: 503,
    },
  );
}
