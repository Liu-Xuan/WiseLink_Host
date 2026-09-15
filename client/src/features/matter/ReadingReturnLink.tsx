import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';

import { Button } from '@client/src/components/ui/button';

import { readingReturnTarget } from './reading-return';
export { readingReturnTarget } from './reading-return';

export default function ReadingReturnLink() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const routeParams = useParams();
  const target = readingReturnTarget(
    params,
    routeParams.documentVersionId ??
      params.get('documentVersionId') ??
      undefined,
  );
  return target ? (
    <div className="border-b border-border p-3">
      <Button
        variant="outline"
        size="sm"
        onClick={() => navigate(target.route)}
      >
        <ArrowLeft aria-hidden="true" />
        {target.label}
      </Button>
    </div>
  ) : null;
}
