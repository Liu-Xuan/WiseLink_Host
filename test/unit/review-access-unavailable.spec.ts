import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
jest.mock('@client/src/components/ui/button', () => ({
  Button: ({
    asChild,
    children,
    ...props
  }: import('react').ComponentProps<'button'> & { asChild?: boolean }) =>
    asChild ? children : createElement('button', props, children),
}));
import ReviewAccessUnavailable from '../../client/src/features/review/ReviewAccessUnavailable';
import {
  reviewErrorRevokesReadback,
  reviewOperationErrorPresentation,
} from '../../client/src/features/review/continuous-review-state';

function render(code: string, statusCode: number, refreshing = false) {
  const error = reviewOperationErrorPresentation(
    { code, statusCode },
    'refresh',
  );
  return renderToStaticMarkup(
    createElement(
      MemoryRouter,
      {
        initialEntries: ['/matters/MAT-1?workRef=MW7&panel=review#discussion'],
      },
      createElement(ReviewAccessUnavailable, {
        error,
        refreshing,
        onReload: jest.fn(),
      }),
    ),
  );
}

describe('protected review access recovery', () => {
  it('shows the existing Host OAuth entry with the exact current return context', () => {
    const html = render('OFFICIAL_OAUTH_SESSION_REQUIRED', 401);
    expect(html).toContain('需要连接飞书身份');
    expect(html).toContain('登录妙搭控制页不代表此连接已恢复');
    expect(html).toContain('恢复飞书身份连接');
    expect(html).toContain(
      '/client/oauth/callback?returnTo=%2Fmatters%2FMAT-1%3FworkRef%3DMW7%26panel%3Dreview%23discussion',
    );
    expect(html).toContain('已完成身份连接，重新读取');
    expect(html).not.toContain('当前复核记录不可访问');
    expect(html).not.toContain('<textarea');
    expect(html).not.toContain('发送并分析');
  });

  it.each([403, 404])(
    'does not mislabel object HTTP %s as OAuth expiry',
    (status) => {
      const html = render('CANONICAL_WORK_ITEM_NOT_FOUND', status);
      expect(html).toContain('当前复核记录不可访问');
      expect(html).not.toContain('/client/oauth/callback');
      expect(html).not.toContain('OAuth');
      expect(reviewErrorRevokesReadback({ statusCode: status })).toBe(true);
    },
  );

  it('disables duplicate reads during a refresh', () => {
    const html = render('CANONICAL_WORK_ITEM_NOT_FOUND', 404, true);
    expect(html).toContain('disabled=""');
    expect(html).toContain('正在读取…');
  });

  it('is wired into the revoked-access early return, before protected content', () => {
    const source = readFileSync(
      resolve(
        __dirname,
        '../../client/src/features/review/ContinuousReviewPanel.tsx',
      ),
      'utf8',
    );
    expect(source).toMatch(
      /if \(accessUnavailable\)\s*\{\s*return \(\s*<ReviewAccessUnavailable/u,
    );
    expect(source).toMatch(
      /error=\{error\}[\s\S]*?onReload=\{\(\) => void readCurrent\(\)\}/u,
    );
  });
});
