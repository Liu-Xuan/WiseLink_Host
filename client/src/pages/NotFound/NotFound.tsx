import { ArrowLeft, FileQuestion } from 'lucide-react';
import { Link } from 'react-router-dom';

import './not-found.css';

const NotFound = () => {
  return (
    <main className="wl-not-found" aria-labelledby="wl-not-found-title">
      <section className="wl-not-found-card wl-glass-content">
        <FileQuestion aria-hidden="true" />
        <p>页面不可用</p>
        <h1 id="wl-not-found-title">没有找到这个页面</h1>
        <span>链接可能已更新，或当前账户没有对应入口。</span>
        <Link to="/library">
          <ArrowLeft aria-hidden="true" /> 返回资料库
        </Link>
      </section>
    </main>
  );
};

export default NotFound;
