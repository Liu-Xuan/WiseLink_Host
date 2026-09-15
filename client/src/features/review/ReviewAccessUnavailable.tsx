import { OfficialOauthLink } from '@client/src/components/OfficialOauthLink';
import { Button } from '@client/src/components/ui/button';
import type { ReviewOperationErrorPresentation } from './continuous-review-state';

export default function ReviewAccessUnavailable({
  error,
  refreshing,
  onReload,
}: {
  error: ReviewOperationErrorPresentation | null;
  refreshing: boolean;
  onReload: () => void;
}) {
  const oauthRequired = error?.code === 'OFFICIAL_OAUTH_SESSION_REQUIRED';
  return (
    <section className="continuous-review" aria-label="持续工程复核">
      {oauthRequired ? (
        <>
          <div role="alert">
            <strong>{error.title}</strong>
            <p>{error.message}</p>
            <p>已清除页面中的讨论、未提交草稿与补充材料。</p>
          </div>
          <Button asChild>
            <OfficialOauthLink>恢复飞书身份连接</OfficialOauthLink>
          </Button>
        </>
      ) : (
        <p role="alert">当前复核记录不可访问，已清除页面中的讨论与补充材料。</p>
      )}
      <Button type="button" disabled={refreshing} onClick={onReload}>
        {refreshing
          ? '正在读取…'
          : oauthRequired
            ? '已完成身份连接，重新读取'
            : '重新读取'}
      </Button>
    </section>
  );
}
