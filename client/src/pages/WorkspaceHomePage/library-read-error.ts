import {
  isCanonicalObjectNotFound,
  summarizeCanonicalDocumentReadFailure,
} from '@client/src/api/canonical-host';

export interface LibraryReadErrorPresentation {
  title: string;
  message: string;
  sourceUnavailable: boolean;
}

/** Presentation for the existing library read, not another API error layer. */
export function libraryReadErrorPresentation(
  reason: unknown,
): LibraryReadErrorPresentation {
  const summary = summarizeCanonicalDocumentReadFailure(reason);
  const message = reason instanceof Error ? reason.message : '';
  if (
    summary.statusCode === 401 ||
    /LOGIN_REQUIRED|UNAUTHORIZED|IDENTITY_REQUIRED|OAUTH/u.test(
      summary.code ?? message,
    )
  ) {
    return {
      title: '请先登录',
      message: '请先登录，再读取当前账户可访问的资料。',
      sourceUnavailable: false,
    };
  }
  if (
    isCanonicalObjectNotFound(reason) ||
    [403, 404].includes(summary.statusCode ?? 0) ||
    (!summary.sourceUnavailable &&
      /NOT_FOUND|无权|FORBIDDEN|403|404/iu.test(message))
  ) {
    return {
      title: '当前工程评估无法读取',
      message: '无法找到该工程评估，或当前账户没有查看权限。',
      sourceUnavailable: false,
    };
  }
  if (summary.sourceUnavailable) {
    return {
      title: '原文暂时无法读取',
      message:
        '原文读取失败，请重试。',
      sourceUnavailable: true,
    };
  }
  return {
    title: '当前工程评估无法读取',
    message:
      summary.code === 'ERR_NETWORK'
        ? '当前连接无法读取资料，请稍后重试。'
        : '当前资料暂时无法读取，请稍后重试。',
    sourceUnavailable: false,
  };
}
