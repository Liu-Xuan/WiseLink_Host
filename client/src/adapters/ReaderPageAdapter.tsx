import { FileQuestion } from 'lucide-react';
import { Link, Navigate, useLocation, useParams, useSearchParams } from 'react-router-dom';
import { legacyReaderTarget } from './legacy-document-routes';
import '../pages/NotFound/not-found.css';

export default function ReaderPageAdapter() {
  const { documentId } = useParams<{ documentId: string }>();
  const [params] = useSearchParams();
  const { hash } = useLocation();
  const target = legacyReaderTarget(documentId, params, hash);
  if (target.route) return <Navigate replace to={target.route} />;
  return (
    <main className="wl-not-found" aria-labelledby="legacy-reader-title">
      <section className="wl-not-found-card wl-glass-content">
        <FileQuestion aria-hidden="true" />
        <h1 id="legacy-reader-title">无法定位原文</h1>
        <p>{target.reason}</p>
        <Link to="/library">返回资料库</Link>
      </section>
    </main>
  );
}
