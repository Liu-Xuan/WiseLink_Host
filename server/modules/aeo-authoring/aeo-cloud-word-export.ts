import { createHash } from 'node:crypto';

import type {
  AeoCloudAuthoringDocument,
  AeoCloudDraftCheckpoint,
  AeoContentBlock,
} from '../../../shared/aeo-editor';

import { projectTiptapToAeoBlocks } from './aeo-editor-projection';
import { buildDeterministicStoredZip } from './aeo-word-export.zip';

export interface AeoCloudWordDraftArtifact {
  bytes: Buffer;
  fileName: string;
  outputSha256: string;
  exportId: string;
}

export function buildAeoCloudWordDraft(
  document: AeoCloudAuthoringDocument,
  checkpoint: AeoCloudDraftCheckpoint,
): AeoCloudWordDraftArtifact {
  if (
    checkpoint.documentId !== document.documentId ||
    checkpoint.workingRevision !== document.workingRevision ||
    checkpoint.contentHash !== document.currentBlockSetHash
  ) {
    throw new Error('AEO_CLOUD_WORD_CHECKPOINT_MISMATCH');
  }
  const result = projectTiptapToAeoBlocks(document.projection);
  const exportId = `AEOWORD-${sha256(
    `${checkpoint.checkpointKey}:${document.currentBlockSetHash}:cloud-draft-word-v1`,
  ).slice(0, 24).toUpperCase()}`;
  const parts: Record<string, string> = {
    '[Content_Types].xml': xml(
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/custom.xml" ContentType="application/vnd.openxmlformats-officedocument.custom-properties+xml"/></Types>',
    ),
    '_rels/.rels': xml(
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/custom-properties" Target="docProps/custom.xml"/></Relationships>',
    ),
    'word/_rels/document.xml.rels': xml(
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>',
    ),
    'word/styles.xml': stylesXml(),
    'word/document.xml': documentXml(document, result.blocks, exportId),
    'docProps/core.xml': coreXml(document),
    'docProps/custom.xml': customXml(document, checkpoint, exportId),
  };
  const bytes = buildDeterministicStoredZip(parts);
  return {
    bytes,
    fileName: `${document.documentKey}.R${document.workingRevision}.DRAFT-CANDIDATE.docx`,
    outputSha256: sha256(bytes),
    exportId,
  };
}

function documentXml(
  document: AeoCloudAuthoringDocument,
  blocks: AeoContentBlock[],
  exportId: string,
): string {
  const content = blocks.map((block, index) => renderBlock(block, index)).join('');
  const unresolved = blocks.flatMap((block) =>
    block.unresolved.map((item) => `${block.blockId}: ${item.message}`),
  );
  return xml(
    `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${p('AEO 工程指令（第二部分）', { bold: true, center: true, size: 32 })}${p('ENGINEERING ORDER — SECTION 2', { bold: true, center: true, size: 24 })}${p('云端草稿候选——非正式 AEO，禁止生产使用', { bold: true, center: true, color: 'C62828', size: 22 })}${p('CLOUD DRAFT CANDIDATE — NOT FOR PRODUCTION USE', { bold: true, center: true, color: 'C62828', size: 18 })}${metadataTable(document, exportId)}${p('结构化工序 / STRUCTURED PROCEDURE', { bold: true, size: 24 })}${content}${p('未决项 / UNRESOLVED ITEMS', { bold: true, size: 24 })}${unresolved.length > 0 ? unresolved.map((item) => p(`• ${item}`, { color: '9C2C33' })).join('') : p('无 / None')}${p(`来源引用数 / Exact source reference count: ${document.sourceManifest.exactSourceRefs.length}`, { color: '5B6472' })}${p(`导出标识 / Export ID: ${exportId}`, { color: '5B6472' })}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="850" w:right="850" w:bottom="850" w:left="850" w:header="360" w:footer="360" w:gutter="0"/></w:sectPr></w:body></w:document>`,
  );
}

function metadataTable(
  document: AeoCloudAuthoringDocument,
  exportId: string,
): string {
  const rows = [
    ['工作副本', document.documentKey],
    ['工作版次', `R${document.workingRevision}`],
    ['内容 SHA-256', document.currentBlockSetHash],
    ['导出标识', exportId],
  ];
  return `<w:tbl><w:tblPr><w:tblBorders><w:top w:val="single" w:sz="8"/><w:left w:val="single" w:sz="8"/><w:bottom w:val="single" w:sz="8"/><w:right w:val="single" w:sz="8"/><w:insideH w:val="single" w:sz="4"/><w:insideV w:val="single" w:sz="4"/></w:tblBorders></w:tblPr><w:tblGrid><w:gridCol w:w="2400"/><w:gridCol w:w="7600"/></w:tblGrid>${rows.map(([label, value]) => `<w:tr>${cell(p(label, { bold: true }), 2400, 'E9EEF7')}${cell(p(value), 7600)}</w:tr>`).join('')}</w:tbl>`;
}

function renderBlock(block: AeoContentBlock, index: number): string {
  const heading = p(
    `${index + 1}. ${block.blockType} · ${block.originType}`,
    { bold: true, color: '1F4E79', size: 20 },
  );
  const trace = p(
    `blockId=${block.blockId} · orderKey=${block.orderKey} · sourceBindings=${block.sourceBindings.length}`,
    { color: '7A8491', size: 14 },
  );
  if (block.blockType === 'PARAGRAPH') {
    return heading + bilingual(block.bodyZh, block.bodyEn) + trace;
  }
  if (block.blockType === 'ORDERED_LIST' || block.blockType === 'UNORDERED_LIST') {
    return heading + block.items.map((item, itemIndex) => {
      const mark = block.blockType === 'ORDERED_LIST' ? `${itemIndex + 1})` : '•';
      return bilingual(
        item.bodyZh ? `${mark} ${item.bodyZh}` : null,
        item.bodyEn ? `${mark} ${item.bodyEn}` : null,
      );
    }).join('') + trace;
  }
  if (block.blockType === 'WARNING' || block.blockType === 'CAUTION' || block.blockType === 'NOTE') {
    const fill = block.blockType === 'WARNING' ? 'FCE8E6' : block.blockType === 'CAUTION' ? 'FFF4D6' : 'EAF2FF';
    return heading + `<w:tbl><w:tblGrid><w:gridCol w:w="10000"/></w:tblGrid><w:tr>${cell(
      p([block.titleZh, block.titleEn].filter(Boolean).join(' / '), { bold: true }) +
        bilingual(block.bodyZh, block.bodyEn),
      10000,
      fill,
    )}</w:tr></w:tbl>` + trace;
  }
  if (block.blockType === 'REFERENCE') {
    return heading + p(`${block.referenceKind}: ${block.referenceLabel}`, { bold: true }) + bilingual(block.bodyZh, block.bodyEn) + p(`targetRef=${block.targetRef}`, { color: '7A8491', size: 14 }) + trace;
  }
  if (block.blockType === 'DATA_TABLE') {
    const widths = block.columns.map(() => Math.floor(10000 / block.columns.length));
    const tableRows = [
      `<w:tr>${block.columns.map((column, columnIndex) => cell(bilingual(column.titleZh, column.titleEn), widths[columnIndex], 'E9EEF7')).join('')}</w:tr>`,
      ...block.rows.map((row) => `<w:tr>${block.columns.map((column, columnIndex) => {
        const data = row.cells.find((candidate) => candidate.columnId === column.columnId);
        return cell(bilingual(data?.textZh ?? null, data?.textEn ?? null), widths[columnIndex]);
      }).join('')}</w:tr>`),
    ];
    return heading + `<w:tbl><w:tblGrid>${widths.map((width) => `<w:gridCol w:w="${width}"/>`).join('')}</w:tblGrid>${tableRows.join('')}</w:tbl>` + trace;
  }
  if (block.blockType === 'CONDITIONAL_BRANCH') {
    return heading + bilingual(block.displayZh, block.displayEn) + p(`outcome=${block.outcomeLabel} · target=${block.targetItemId} · review=${block.reviewState}`, { color: '7A3E00', size: 15 }) + trace;
  }
  if (block.blockType === 'IMAGE') {
    return heading + p(`图片占位 / IMAGE PLACEHOLDER: ${block.fileName}`, { bold: true, color: '7A3E00' }) + bilingual(block.captionZh, block.captionEn) + p(`imageRef=${block.imageRef} · sha256=${block.sha256} · 原始图片字节尚未进入当前候选资产包`, { color: '9C2C33', size: 14 }) + trace;
  }
  throw new Error(`AEO_CLOUD_WORD_BLOCK_UNSUPPORTED:${block.blockType}`);
}

function bilingual(zh: string | null, en: string | null): string {
  return `${zh ? p(`ZH  ${zh}`) : ''}${en ? p(`EN  ${en}`, { color: '334E68' }) : ''}`;
}

function cell(content: string, width: number, fill?: string): string {
  return `<w:tc><w:tcPr><w:tcW w:w="${width}" w:type="dxa"/>${fill ? `<w:shd w:fill="${fill}"/>` : ''}</w:tcPr>${content || p('—')}</w:tc>`;
}

function p(
  text: string,
  options: {
    bold?: boolean;
    center?: boolean;
    color?: string;
    size?: number;
  } = {},
): string {
  const properties = `${options.center ? '<w:jc w:val="center"/>' : ''}`;
  const runProperties = `<w:rFonts w:ascii="Heiti SC" w:hAnsi="Heiti SC" w:eastAsia="Heiti SC" w:cs="Heiti SC" w:hint="eastAsia"/>${options.bold ? '<w:b/>' : ''}${options.color ? `<w:color w:val="${options.color}"/>` : ''}${options.size ? `<w:sz w:val="${options.size}"/><w:szCs w:val="${options.size}"/>` : ''}`;
  return `<w:p><w:pPr>${properties}<w:spacing w:after="80" w:line="270" w:lineRule="auto"/></w:pPr><w:r><w:rPr>${runProperties}</w:rPr><w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r></w:p>`;
}

function coreXml(document: AeoCloudAuthoringDocument): string {
  return xml(
    `<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>${escapeXml(document.documentKey)} cloud draft candidate</dc:title><dc:subject>AEO structured authoring draft export</dc:subject><dc:creator>Ameco AI协同中枢 AEO Authoring Studio</dc:creator><dc:description>CLOUD DRAFT CANDIDATE — NOT FOR PRODUCTION USE</dc:description></cp:coreProperties>`,
  );
}

function customXml(
  document: AeoCloudAuthoringDocument,
  checkpoint: AeoCloudDraftCheckpoint,
  exportId: string,
): string {
  const values = [
    ['DocumentKey', document.documentKey],
    ['WorkingRevision', String(document.workingRevision)],
    ['CheckpointKey', checkpoint.checkpointKey],
    ['AuthoringContentHash', document.currentBlockSetHash],
    ['ExportId', exportId],
    ['Authority', 'DRAFT_EXPORT_NOT_RELEASE'],
    ['ProductionEligible', 'false'],
  ];
  return xml(
    `<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/custom-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">${values.map(([name, value], index) => `<property fmtid="{D5CDD505-2E9C-101B-9397-08002B2CF9AE}" pid="${index + 2}" name="${escapeXml(name)}"><vt:lpwstr>${escapeXml(value)}</vt:lpwstr></property>`).join('')}</Properties>`,
  );
}

function stylesXml(): string {
  return xml(
    '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Heiti SC" w:hAnsi="Heiti SC" w:eastAsia="Heiti SC" w:cs="Heiti SC"/><w:sz w:val="20"/><w:szCs w:val="20"/><w:lang w:val="en-US" w:eastAsia="zh-CN"/></w:rPr></w:rPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style></w:styles>',
  );
}

function escapeXml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function sha256(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

function xml(content: string): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>${content}`;
}
