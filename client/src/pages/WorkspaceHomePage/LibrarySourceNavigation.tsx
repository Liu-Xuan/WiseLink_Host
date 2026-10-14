import { Link } from 'react-router-dom';

export function LibrarySourceNavigation({ current }: { current: 'document' | 'lcm' }) {
  return <nav className="library-source-navigation" aria-label="资料类型">
    <Link to="/library?mode=document" aria-current={current === 'document' ? 'page' : undefined}>工程文档</Link>
    <Link to="/library?mode=lcm" aria-current={current === 'lcm' ? 'page' : undefined}>软件构型</Link>
  </nav>;
}
