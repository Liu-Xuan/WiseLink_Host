import { useState } from 'react';
import TrinitySituationView from '@client/src/features/trinity/TrinitySituationView';
import { TRINITY_SAMPLE_FIXTURE } from '@client/src/features/trinity/trinity-fixture';
import type {
  TrinityLevel,
  TrinityNavigationTarget,
} from '@client/src/features/trinity/trinity-types';

interface PreviewSelection {
  stageId: string;
  sourceId: string;
}

export default function EngineeringSituationVisualPreviewPage() {
  const [level, setLevel] = useState<TrinityLevel>('macro');
  const [fleet, setFleet] = useState('all');
  const [focusMatterId, setFocusMatterId] = useState(
    TRINITY_SAMPLE_FIXTURE.matters[0]?.id ?? '',
  );
  const [selection, setSelection] = useState<PreviewSelection>({
    stageId: '',
    sourceId: '',
  });

  const changeLevel = (next: TrinityLevel): void => {
    setLevel(next);
    setSelection({ stageId: '', sourceId: '' });
  };

  const handleNavigate = (target: TrinityNavigationTarget): void => {
    if (target.type !== 'focus-matter') return;
    setFocusMatterId(target.matterId);
    changeLevel('focus');
  };

  return <div data-preview="isolated-situation-fixture">
    <TrinitySituationView
      data={TRINITY_SAMPLE_FIXTURE}
      level={level}
      fleet={fleet}
      focusMatterId={focusMatterId}
      selectedStageId={selection.stageId}
      selectedSourceId={selection.sourceId}
      onLevelChange={changeLevel}
      onFleetChange={setFleet}
      onFocusMatterChange={setFocusMatterId}
      onSelectionChange={setSelection}
      onNavigate={handleNavigate}
    />
  </div>;
}
