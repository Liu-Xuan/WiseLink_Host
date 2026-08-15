import type {
  AeoContentBlock,
  AeoCloudSourceManifest,
} from '../../../shared/aeo-editor';
import type {
  AeoAuthoringBootstrapArtifact,
  AeoSimilarCandidateSummary,
  AeoWorkItemReadModel,
} from '../../../shared/aeo-integration';
import type {
  AeoContentNode,
  AeoDocxAuthoringRenderedRegionEnrichedParsePackageCandidate,
} from '../../../shared/aeo-structured-parse';

import { normalizeAeoSpecialistDocxFinalPackage } from './aeo-specialist-package.validation';
import { projectionError, sha256Hex } from './aeo-editor-projection.utils';
import { projectAeoBlocksToTiptap } from './aeo-editor-projection';
import { summarizeAeoProjection } from './aeo-authoring.service';
import { projectTiptapToAeoBlocks } from './aeo-editor-projection';

const EDITABLE_TYPES = new Set([
  'WORK_ITEM',
  'PROCEDURE_SUBSTEP',
  'NOTE_CALLOUT',
  'SAFETY_CALLOUT',
]);

export function projectAeoParsedPackageToBootstrap(
  value: unknown,
  workItem: AeoWorkItemReadModel,
): Pick<
  AeoAuthoringBootstrapArtifact,
  | 'procedureItemId'
  | 'projection'
  | 'validation'
  | 'sourceManifest'
  | 'candidateKnowledge'
> {
  const parsed = normalizeForWorkItem(value, workItem);
  const nodes = parsed.nodes
    .filter((node) => EDITABLE_TYPES.has(node.nodeType))
    .filter((node) => Boolean(node.bodyZh || node.bodyEn))
    .sort((left, right) => left.sequence - right.sequence);
  if (nodes.length === 0) {
    projectionError(
      'AEO_ARTIFACT_INPUT_HASH_MISMATCH',
      'Reader 接受的 AEO ParsedPackage 没有可生成初始编辑候选的步骤节点。',
    );
  }
  const procedureItemId = `AEOPROC-${sha256Hex(
    `${workItem.workItemId}:${parsed.parsePackageId}`,
  )
    .slice(0, 24)
    .toUpperCase()}`;
  const projection = projectAeoBlocksToTiptap(
    procedureItemId,
    nodes.map((node, index) => toCandidateBlock(node, parsed, index)),
  );
  const validation = summarizeAeoProjection(
    projectTiptapToAeoBlocks(projection),
  );
  const sourceManifest: AeoCloudSourceManifest = {
    sourceNotice:
      '由同一 WorkItem 中经 Unified Reader 接受的 exact AEO ParsedPackage 生成；全部为待工程师逐项决定的文档实例候选。',
    exactSourceRefs: unique(
      nodes.flatMap((node) =>
        node.sourceRefs.map((ref) => exactSourceRef(ref, node.nodeId, parsed)),
      ),
    ),
    adoptionDecisions: [],
  };
  const candidateKnowledge = nodes.map((node) =>
    toCandidateKnowledge(node, parsed, workItem),
  );
  return {
    procedureItemId,
    projection,
    validation,
    sourceManifest,
    candidateKnowledge,
  };
}

function normalizeForWorkItem(
  value: unknown,
  workItem: AeoWorkItemReadModel,
): AeoDocxAuthoringRenderedRegionEnrichedParsePackageCandidate {
  const formalAeoIdentity = readFormalString(value, 'formalAeoIdentity');
  const revision = readFormalString(value, 'revision');
  const iteration = readFormalString(value, 'iteration');
  const acceptedWorkItemIdentities = new Set([
    formalAeoIdentity,
    `${formalAeoIdentity}-${revision}`,
    `${formalAeoIdentity}-${revision}-${iteration}`,
  ]);
  if (!acceptedWorkItemIdentities.has(workItem.authoringSeed.aeoIdentity)) {
    projectionError(
      'AEO_ARTIFACT_INPUT_HASH_MISMATCH',
      'ParsedPackage 的正式 AEO identity/revision 与 authoring seed 不一致。',
    );
  }
  const source = {
    formalAeoIdentity,
    revision,
    iteration,
    sourceMediaType: readOriginalString(value, 'mediaType'),
    sourceByteLength: readOriginalInteger(value, 'byteLength'),
    sourceSha256: readOriginalString(value, 'sha256'),
    currentness: readString(value, 'currentness'),
    parsePackageId: workItem.authoringSeed.parsedPackage.packageId,
    parsePackageHash: readString(value, 'packageHash'),
  };
  try {
    return normalizeAeoSpecialistDocxFinalPackage(value, source);
  } catch (error) {
    const code =
      error && typeof error === 'object' && 'code' in error
        ? String(error.code)
        : 'AEO_PARSED_PACKAGE_INVALID';
    projectionError(
      'AEO_ARTIFACT_INPUT_HASH_MISMATCH',
      `${code}: Reader 接受的 ParsedPackage 与当前 AEO WorkItem 输入链不一致。`,
    );
  }
}

function toCandidateBlock(
  node: AeoContentNode,
  parsed: AeoDocxAuthoringRenderedRegionEnrichedParsePackageCandidate,
  index: number,
): AeoContentBlock {
  const base = {
    blockId: `AEOBLK-${sha256Hex(`${parsed.packageHash}:${node.nodeId}`)
      .slice(0, 24)
      .toUpperCase()}`,
    orderKey: String((index + 1) * 10).padStart(6, '0'),
    originType: 'HISTORICAL_OCCURRENCE_COPIED' as const,
    sourceBindings: node.sourceRefs.map((ref, refIndex) => ({
      bindingId: `AEOSRC-${sha256Hex(
        `${parsed.packageHash}:${node.nodeId}:${refIndex}`,
      )
        .slice(0, 24)
        .toUpperCase()}`,
      originType: 'HISTORICAL_OCCURRENCE_COPIED' as const,
      usage: 'REFERENCE_ONLY' as const,
      sourceArtifactRef: ref.sourceArtifactId,
      sourceNodeRef: node.nodeId,
      sourceVersion: `${parsed.formalIdentity.revision}/${parsed.formalIdentity.iteration}`,
      sourceSha256: ref.sourceArtifactSha256,
      locator: ref.locator,
      language:
        node.bodyZh && node.bodyEn
          ? ('BILINGUAL' as const)
          : node.bodyZh
            ? ('ZH' as const)
            : ('EN' as const),
    })),
    engineerDecisionRef: null,
    unresolved: [
      {
        unresolvedId: `AEOUNRES-${sha256Hex(
          `${parsed.packageHash}:${node.nodeId}:ENGINEER_REVIEW`,
        )
          .slice(0, 24)
          .toUpperCase()}`,
        code: 'AEO_DOCUMENT_OCCURRENCE_REQUIRES_ENGINEER_DECISION',
        message:
          '历史 AEO/解析步骤仅为候选；工程师必须明确采用、改写、重排或不纳入。',
        severity: 'BLOCKING' as const,
        blocksCheckpoint: true,
      },
    ],
  };
  if (node.nodeType === 'NOTE_CALLOUT') {
    return {
      ...base,
      blockType: 'NOTE',
      titleZh: node.titleZh ?? '注',
      titleEn: node.titleEn ?? 'NOTE',
      bodyZh: node.bodyZh,
      bodyEn: node.bodyEn,
    };
  }
  if (node.nodeType === 'SAFETY_CALLOUT') {
    const caution = /CAUTION|注意/u.test(
      `${node.titleZh ?? ''} ${node.titleEn ?? ''}`,
    );
    return {
      ...base,
      blockType: caution ? 'CAUTION' : 'WARNING',
      titleZh: node.titleZh,
      titleEn: node.titleEn,
      bodyZh: node.bodyZh,
      bodyEn: node.bodyEn,
    };
  }
  return {
    ...base,
    blockType: 'PARAGRAPH',
    bodyZh: node.bodyZh,
    bodyEn: node.bodyEn,
  };
}

function toCandidateKnowledge(
  node: AeoContentNode,
  parsed: AeoDocxAuthoringRenderedRegionEnrichedParsePackageCandidate,
  workItem: AeoWorkItemReadModel,
): AeoSimilarCandidateSummary {
  return {
    candidateId: `AEOKU-${sha256Hex(`${parsed.packageHash}:${node.nodeId}`)
      .slice(0, 24)
      .toUpperCase()}`,
    sourceKind: 'HISTORICAL_AEO',
    title: candidateTitle(node),
    reason:
      '来自同一 WorkItem 的 Reader-accepted AEO ParsedPackage；仍需工程师逐项决定，不代表公司规则。',
    sourceArtifactRef: workItem.authoringSeed.parsedPackage.artifactRef,
    sourceArtifactSha256: workItem.authoringSeed.parsedPackage.artifactSha256,
    eligibility: 'CANDIDATE_REQUIRES_REVIEW',
  };
}

function candidateTitle(node: AeoContentNode): string {
  const title =
    node.titleZh ?? node.bodyZh ?? node.titleEn ?? node.bodyEn ?? node.nodeId;
  return title.length > 200 ? `${title.slice(0, 197)}...` : title;
}

function exactSourceRef(
  ref: AeoContentNode['sourceRefs'][number],
  nodeId: string,
  parsed: AeoDocxAuthoringRenderedRegionEnrichedParsePackageCandidate,
): string {
  return `${ref.sourceArtifactId}@${parsed.formalIdentity.revision}/${parsed.formalIdentity.iteration}#${nodeId}:${ref.sourceArtifactSha256}`;
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values)).sort();
}

function readRecord(value: unknown, key: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    invalidParsedPackage();
  }
  const nested = (value as Record<string, unknown>)[key];
  if (!nested || typeof nested !== 'object' || Array.isArray(nested)) {
    invalidParsedPackage();
  }
  return nested as Record<string, unknown>;
}

function readString(value: unknown, key: string): string {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    invalidParsedPackage();
  }
  const result = (value as Record<string, unknown>)[key];
  if (typeof result !== 'string' || result.length === 0) {
    invalidParsedPackage();
  }
  return result;
}

function readFormalString(value: unknown, key: string): string {
  return readString(readRecord(value, 'formalIdentity'), key);
}

function readOriginalString(value: unknown, key: string): string {
  return readString(readRecord(value, 'originalSource'), key);
}

function readOriginalInteger(value: unknown, key: string): number {
  const result = readRecord(value, 'originalSource')[key];
  if (!Number.isSafeInteger(result) || Number(result) < 1) {
    invalidParsedPackage();
  }
  return Number(result);
}

function invalidParsedPackage(): never {
  projectionError(
    'AEO_ARTIFACT_INPUT_HASH_MISMATCH',
    'Reader 接受的 AEO ParsedPackage 缺少专项解析身份或原件绑定字段。',
  );
}
