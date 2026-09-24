/**
 * DocumentReadingListService - 文档解读批量查询服务
 *
 * 为资料库提供高性能的批量文档解读查询
 */

import { Injectable } from '@nestjs/common';
import type { DocumentReadingPreview } from '@shared/document-reading.interface';
import { DocumentReadingRunRepository } from './document-reading-run.repository';
import { DocumentParsingHostedService } from '../document-management/src/hosted/nest/document-parsing-hosted.service';

export interface DocumentReadingBatchPreviewItem {
  documentVersionId: string;
  parseRunId: string | null;
  semanticRevision: number | null;
  headline: string | null;
  briefSummary: string | null;
  status: 'AVAILABLE' | 'RETRACTED' | 'SOURCE_CHANGED' | 'NOT_GENERATED' | 'UNAUTHORIZED';
}

export type ParseRunScope = 'current' | 'all';

export interface ReadingContext {
  tenantId: string;
  actorUserId: string;
}

@Injectable()
// Registered by CanonicalHostModule.forRoot.
// eslint-disable-next-line @darraghor/nestjs-typed/injectable-should-be-provided
export class DocumentReadingListService {
  constructor(
    private readonly runs: DocumentReadingRunRepository,
    private readonly parsing: DocumentParsingHostedService
  ) {}

  /**
   * 批量查询文档解读预览
   *
   * @param documentVersionIds - 文档版本ID列表
   * @param scope - 查询范围：'current' 只查询当前版本，'all' 查询所有版本
   * @param context - 用户上下文
   * @returns 文档解读预览列表
   */
  async getBatchPreview(
    documentVersionIds: string[],
    scope: ParseRunScope,
    context: ReadingContext
  ): Promise<DocumentReadingBatchPreviewItem[]> {
    // 批量查询所有文档的解读状态
    const results = await Promise.allSettled(
      documentVersionIds.map(async documentVersionId => {
        return this.getDocumentReadingPreview(documentVersionId, scope, context);
      })
    );

    // 处理结果
    return results.map((result, index) => {
      const documentVersionId = documentVersionIds[index];

      if (result.status === 'rejected') {
        // 查询失败，返回未授权或错误状态
        return {
          documentVersionId,
          parseRunId: null,
          semanticRevision: null,
          headline: null,
          briefSummary: null,
          status: 'UNAUTHORIZED' as const,
        };
      }

      return result.value;
    });
  }

  /**
   * 获取单个文档的解读预览
   */
  private async getDocumentReadingPreview(
    documentVersionId: string,
    scope: ParseRunScope,
    context: ReadingContext
  ): Promise<DocumentReadingBatchPreviewItem> {
    try {
      // 查询文档的最新完成解读
      const readingScope = {
        tenantId: context.tenantId,
        actorUserId: context.actorUserId,
        documentVersionId,
      };

      // 查询最近完成的解读
      const latestReading = await this.runs.getLatestCompleted(readingScope);

      if (!latestReading) {
        // 没有解读记录
        return {
          documentVersionId,
          parseRunId: null,
          semanticRevision: null,
          headline: null,
          briefSummary: null,
          status: 'NOT_GENERATED',
        };
      }

      if (latestReading.retracted) {
        return {
          documentVersionId,
          parseRunId: latestReading.parseRunId,
          semanticRevision: latestReading.semanticRevision,
          headline: null,
          briefSummary: null,
          status: 'RETRACTED',
        };
      }

      // 提取简要信息
      const headline = latestReading.savedReading?.headline || null;
      const brief = latestReading.savedReading?.brief || null;

      // 将 brief 转换为简短摘要（40-80字）
      const briefSummary = brief ? this.extractBriefSummary(brief) : null;

      return {
        documentVersionId,
        parseRunId: latestReading.parseRunId,
        semanticRevision: latestReading.semanticRevision,
        headline,
        briefSummary,
        status: 'AVAILABLE',
      };
    } catch (error) {
      // 查询失败
      return {
        documentVersionId,
        parseRunId: null,
        semanticRevision: null,
        headline: null,
        briefSummary: null,
        status: 'UNAUTHORIZED',
      };
    }
  }

  /**
   * 从完整 brief 提取简短摘要（40-80字）
   *
   * @param brief - 完整的 brief 文本
   * @returns 简短摘要
   */
  private extractBriefSummary(brief: string | { text: string }): string {
    // 处理 DocumentReadingStatement 格式
    const text = typeof brief === 'string' ? brief : brief.text;

    if (!text) return '';

    // 去除多余空白
    const cleaned = text.replace(/\s+/g, ' ').trim();

    // 如果已经足够短，直接返回
    if (cleaned.length <= 80) {
      return cleaned;
    }

    // 截取前80字，尽量在句号处截断
    const truncated = cleaned.substring(0, 100);
    const sentenceEnd = truncated.lastIndexOf('。');
    if (sentenceEnd > 40) {
      return truncated.substring(0, sentenceEnd + 1);
    }

    // 如果没有句号，在80字处截断并加省略号
    return cleaned.substring(0, 80) + '…';
  }
}
