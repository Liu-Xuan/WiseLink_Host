import { Navigate, useLocation, useParams } from 'react-router-dom';

import { legacyDocumentWorkbenchRoute } from './document-parsing-navigation';

export default function LegacyDocumentWorkbenchRoute() {
  const location = useLocation();
  const { workItemId = '' } = useParams<{ workItemId: string }>();
  const target: URL = new URL(
    legacyDocumentWorkbenchRoute(workItemId, location.search),
    'https://wiselink.invalid',
  );

  return (
    <Navigate
      replace
      to={{
        pathname: target.pathname,
        search: target.search,
        hash: location.hash,
      }}
      state={location.state}
    />
  );
}
