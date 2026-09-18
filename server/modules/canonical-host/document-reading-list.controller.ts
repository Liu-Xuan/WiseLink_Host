/**
 * DocumentReadingListController - 批量查询文档解读
 *
 * 为资料库提供轻量级的文档解读列表投影
 */

import { BadRequestException, Controller, Get, Header, Query, Req, UseGuards } from '@nestjs/common';
import { NeedLogin } from '@lark-apaas/fullstack-nestjs-core';
import type { Request } from 'express';
import { ProductionMiaodaBrowserObjectIngressGuard } from '../work-item/production-miaoda-browser-ingress';
import { contextFromRequest } from '../document-management/src/hosted/nest/document-management-hosted.controller';
import { DocumentReadingListService } from './document-reading-list.service';

/**
 * 批量文档解读预览响应
 */
export interface DocumentReadingBatchPreviewResponse {
  readings: Array<{
    documentVersionId: string;
    parseRunId: string | null;
    semanticRevision: number | null;
    headline: string | null;
    briefSummary: string | null;
    status: 'AVAILABLE' | 'SOURCE_CHANGED' | 'NOT_GENERATED' | 'UNAUTHORIZED';
  }>;
}

@NeedLogin()
@UseGuards(ProductionMiaodaBrowserObjectIngressGuard)
@Controller('api/canonical-host/documents')
// Registered in CanonicalHostModule.forRoot dynamic controllers.
// eslint-disable-next-line @darraghor/nestjs-typed/injectable-should-be-provided
export class DocumentReadingListController {
  constructor(private readonly listService: DocumentReadingListService) {}

  /**
   * 批量查询文档解读预览
   *
   * GET /api/canonical-host/documents/readings/preview?documentVersionIds=id1,id2,id3
   *
   * 查询参数:
   * - documentVersionIds: 逗号分隔的文档版本ID列表（最多100个）
   * - parseRunScope: 可选，'current' | 'all'，默认 'current'
   *
   * 返回轻量级的解读预览，用于资料库表格显示
   */
  @Get('readings/preview')
  @Header('Cache-Control', 'private, max-age=60')
  async getBatchPreview(
    @Query('documentVersionIds') documentVersionIds: string,
    @Query('parseRunScope') parseRunScope: string | undefined,
    @Req() request: Request
  ): Promise<DocumentReadingBatchPreviewResponse> {
    // 参数验证
    if (!documentVersionIds || typeof documentVersionIds !== 'string') {
      throw new BadRequestException('DOCUMENT_VERSION_IDS_REQUIRED');
    }

    // 解析文档ID列表
    const ids = documentVersionIds
      .split(',')
      .map(id => id.trim())
      .filter(id => id.length > 0);

    // 限制批量大小
    if (ids.length === 0) {
      throw new BadRequestException('DOCUMENT_VERSION_IDS_EMPTY');
    }
    if (ids.length > 100) {
      throw new BadRequestException('DOCUMENT_VERSION_IDS_TOO_MANY');
    }

    // 验证ID格式
    const idRegex = /^[A-Za-z0-9_-]{1,96}$/;
    for (const id of ids) {
      if (!idRegex.test(id)) {
        throw new BadRequestException(`INVALID_DOCUMENT_VERSION_ID: ${id}`);
      }
    }

    // 解析 parseRunScope
    const scope = parseRunScope === 'all' ? 'all' : 'current';

    // 获取上下文
    const context = contextFromRequest(request);

    // 批量查询
    const readings = await this.listService.getBatchPreview(ids, scope, context);

    return { readings };
  }
}
