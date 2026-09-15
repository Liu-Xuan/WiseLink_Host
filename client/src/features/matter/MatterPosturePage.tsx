import { useEffect } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useCurrentUserSession } from '@client/src/app/providers/CurrentUserSessionProvider';
import { useCurrentObjectContext } from '@client/src/app/providers/CurrentObjectContextProvider';
import { Button } from '@client/src/components/ui/button';
import useEngineeringMatter from './useEngineeringMatter';
import { buildMatterObjectContext } from './matter-navigation';
import MatterPosture from './MatterPosture';

export default function MatterPosturePage() {
  const { matterId = '' } = useParams<{ matterId: string }>();
  const { sessionGeneration, authenticationRequired } = useCurrentUserSession();
  const { publishCurrentObject } = useCurrentObjectContext();
  const read = useEngineeringMatter(
    matterId,
    sessionGeneration,
    authenticationRequired,
  );
  useEffect(() => {
    publishCurrentObject(
      read.data
        ? buildMatterObjectContext(read.data.matter, read.data.working)
        : null,
    );
    return () => publishCurrentObject(null);
  }, [read.data, publishCurrentObject]);
  return (
    <main className="p-4 md:p-6" aria-label="选中事项工程态势">
      <nav
        className="mb-4 flex flex-wrap items-center gap-4"
        aria-label="工程态势导航"
      >
        <Link className="underline" to="/library">
          返回资料库
        </Link>
        <Link
          className="underline"
          to={`/matters/${encodeURIComponent(matterId)}`}
        >
          事项简报
        </Link>
        <Button
          variant="outline"
          disabled={read.loading || authenticationRequired}
          onClick={() => void read.refresh().catch(() => undefined)}
        >
          重新读取
        </Button>
      </nav>
      {read.loading ? (
        <p role="status">
          正在读取已保存工作
          {read.data ? '；仍显示上次读取，尚未核实最新状态' : ''}。
        </p>
      ) : null}
      {read.error ? (
        <p role="alert">
          {read.error}
          {read.data ? ' 当前保留上次已保存读取，不代表最新状态。' : ''}
        </p>
      ) : null}
      {read.data ? (
        <MatterPosture data={read.data} />
      ) : !read.loading && !read.error ? (
        <p>尚未取得当前事项，不展示其他事项作为替代。</p>
      ) : null}
    </main>
  );
}
