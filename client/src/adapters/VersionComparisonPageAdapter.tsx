import { FileQuestion } from 'lucide-react';
import { Link, Navigate, useLocation, useParams, useSearchParams } from 'react-router-dom';
import { legacyComparisonTarget } from './legacy-document-routes';
import '../pages/NotFound/not-found.css';

export default function VersionComparisonPageAdapter() {
  const { documentId } = useParams<{ documentId: string }>();
  const [params] = useSearchParams();
  const { hash } = useLocation();
  const target = legacyComparisonTarget(documentId, params, hash);
  if (target.route) return <Navigate replace to={target.route} />;
  return (
    <main className="wl-not-found" aria-labelledby="legacy-comparison-title">
      <section className="wl-not-found-card wl-glass-content">
        <FileQuestion aria-hidden="true" />
        <h1 id="legacy-comparison-title">无法比较版本</h1>
        <p>{target.reason}</p>
        {documentId ? (
          <Link to={`/document-versions/${encodeURIComponent(documentId)}`}>
            阅读指定版本
          </Link>
        ) : (
          <Link to="/library">返回资料库</Link>
        )}
      </section>
    </main>
  );
}
