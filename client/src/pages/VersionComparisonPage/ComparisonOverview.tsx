interface DocumentVersion {
  id: string;
  familyId: string;
  version: string;
  title: string;
  blocks: Array<{
    id: string;
    role: string;
    zh: string;
  }>;
}

interface ComparisonOverviewProps {
  newer: DocumentVersion;
  older: DocumentVersion;
}

export default function ComparisonOverview({
  newer,
  older,
}: ComparisonOverviewProps) {
  const revisionBlock = newer.blocks.find((b) => b.id === 'block-revision' || b.role === 'revision');
  const revisionNote = revisionBlock?.zh || '未提供修订说明。';

  return (
    <div className="comparison-overview panel">
      <div className="overview-section">
        <small>文件业务换版</small>
        <h2>
          {older.version} → {newer.version}
        </h2>
      </div>

      <div className="overview-section">
        <small>本版修订说明</small>
        <p>{revisionNote}</p>
      </div>

      <div className="overview-section">
        <small>对事项认识</small>
        <p>按实际变化继续有关问题，不跨文件修改其他受控要求。</p>
      </div>
    </div>
  );
}
