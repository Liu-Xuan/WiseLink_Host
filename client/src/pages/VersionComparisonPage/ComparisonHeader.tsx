interface ComparisonHeaderProps {
  currentFamilyId: string;
  availableFamilies: Array<{ id: string; familyId: string; title: string }>;
  onFamilyChange: (documentId: string) => void;
  onBack: () => void;
}

export default function ComparisonHeader({
  currentFamilyId,
  availableFamilies,
  onFamilyChange,
  onBack,
}: ComparisonHeaderProps) {
  return (
    <div className="comparison-header">
      <div className="comparison-header-content">
        <div className="comparison-title-section">
          <h1>文件自身换版比较</h1>
          <p>{currentFamilyId} · 按本版修订说明核对对应原文，其他文件保持各自身份。</p>
        </div>

        <div className="comparison-actions">
          <button className="btn btn-secondary" onClick={onBack}>
            返回
          </button>

          <select
            className="family-select"
            value={availableFamilies.find(f => f.familyId === currentFamilyId)?.id || ''}
            onChange={(e) => onFamilyChange(e.target.value)}
            aria-label="选择有历史版本的文档族"
          >
            {availableFamilies.map((family) => (
              <option key={family.id} value={family.id}>
                {family.familyId} - {family.title}
              </option>
            ))}
          </select>
        </div>
      </div>
    </div>
  );
}
