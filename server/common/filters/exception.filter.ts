import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import type { Response } from 'express';
import { BusinessException } from '../interfaces/exception.interface';
import {
  HTTP_STATUS_TO_RESPONSE_CODE_MAP,
  ResponseCode,
} from '../constants/api_response_code';
import { ApiErrorResponse } from '../interfaces/api_response.interface';

// 全局异常过滤器，用于捕获所有未处理的异常
@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();

    // 如果响应头已发送，则不处理
    if (response.headersSent) {
      return;
    }

    let errorResponse: Omit<ApiErrorResponse, 'httpStatus'>;
    let httpStatus: HttpStatus;

    if (exception instanceof BusinessException) {
      // 业务异常
      httpStatus = exception.httpStatus;
      errorResponse = {
        error: {
          code: exception.code,
          message: exception.message,
          details: exception.details,
          fieldErrors: exception.fieldErrors,
          timestamp: Date.now(),
        },
      };
    } else if (exception instanceof HttpException) {
      // HTTP异常
      httpStatus = exception.getStatus() as HttpStatus;
      const exceptionResponse = exception.getResponse();

      errorResponse = {
        error: {
          code: HTTP_STATUS_TO_RESPONSE_CODE_MAP[httpStatus],
          message:
            typeof exceptionResponse === 'string'
              ? exceptionResponse
              : exception.message,
          details:
            typeof exceptionResponse === 'object'
              ? JSON.stringify(exceptionResponse)
              : undefined,
          timestamp: Date.now(),
        },
      };
    } else if (isStatusBearingError(exception)) {
      // 内部模块的稳定错误对象：保留服务端定义的 HTTP 状态与机器码，
      // 不把明确的权限/输入拒绝误报成 500。
      httpStatus = exception.statusCode as HttpStatus;
      errorResponse = {
        error: {
          code: exception.code,
          message: exception.message,
          details: serializeDetails(exception.details),
          retryable: exception.retryable,
          operatorAction: exception.operatorAction,
          timestamp: Date.now(),
        },
      };
    } else if (
      typeof exception === 'object' &&
      exception !== null &&
      (exception as { code?: unknown }).code === '22P02'
    ) {
      // Postgres invalid_text_representation：路径/查询参数与列类型不匹配（最常见是非法 UUID）
      // 与「合法 UUID 但记录不存在」走同一条 not-found 语义，避免 500 噪声
      httpStatus = HttpStatus.NOT_FOUND;
      errorResponse = {
        error: {
          code: ResponseCode.NOT_FOUND,
          message: '资源不存在',
          timestamp: Date.now(),
        },
      };
    } else {
      // 未知异常
      httpStatus = HttpStatus.INTERNAL_SERVER_ERROR;
      errorResponse = {
        error: {
          code: ResponseCode.INTERNAL_ERROR,
          message: '服务器内部错误',
          stack: (exception as Error).stack,
          cause: (exception as Error).cause as string,
          timestamp: Date.now(),
        },
      };
    }

    response.status(httpStatus).json(errorResponse);
  }
}

interface StatusBearingError {
  code: string;
  message: string;
  statusCode: number;
  details?: unknown;
  retryable?: boolean;
  operatorAction?: string;
}

function isStatusBearingError(value: unknown): value is StatusBearingError {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Partial<StatusBearingError>;
  return (
    typeof candidate.code === 'string' &&
    candidate.code.length > 0 &&
    typeof candidate.message === 'string' &&
    Number.isInteger(candidate.statusCode) &&
    Number(candidate.statusCode) >= 400 &&
    Number(candidate.statusCode) <= 599 &&
    (candidate.retryable === undefined ||
      typeof candidate.retryable === 'boolean') &&
    (candidate.operatorAction === undefined ||
      typeof candidate.operatorAction === 'string')
  );
}

function serializeDetails(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  return typeof value === 'string' ? value : JSON.stringify(value);
}
