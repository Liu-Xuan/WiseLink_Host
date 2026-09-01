import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { useLocation } from 'react-router-dom';

export type CurrentObjectKind = 'DOCUMENT' | 'MATTER';

export interface CurrentObjectRoutes {
  overview: string;
  workspace: string;
  process: string;
  jobAid: string;
  review: string;
  history: string;
  family: string;
}

export interface CurrentObjectContextView {
  kind: CurrentObjectKind;
  routeWorkItemId: string;
  displayCode: string;
  title: string;
  meta: string;
  parentLabel?: string;
  statusLabel: string;
  routes: CurrentObjectRoutes;
  badges?: {
    process?: number;
    jobAid?: string;
    review?: number;
    family?: number;
  };
}

interface CurrentObjectContextValue {
  currentObject: CurrentObjectContextView | null;
  publishCurrentObject: (view: CurrentObjectContextView | null) => void;
}

const CurrentObjectContext = createContext<CurrentObjectContextValue | null>(
  null,
);

function decodeRouteSegment(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return '';
  }
}

export function currentRouteWorkItemId(
  pathname: string,
  search: string,
): string {
  const routeMatch: RegExpMatchArray | null = pathname.match(
    /\/work-items\/([^/]+)/u,
  );
  if (routeMatch?.[1]) return decodeRouteSegment(routeMatch[1]);
  if (pathname !== '/library') return '';
  return new URLSearchParams(search).get('workItemId')?.trim() ?? '';
}

export function CurrentObjectContextProvider({
  children,
}: {
  children: ReactNode;
}) {
  const location = useLocation();
  const routeWorkItemId: string = currentRouteWorkItemId(
    location.pathname,
    location.search,
  );
  const [published, setPublished] = useState<CurrentObjectContextView | null>(
    null,
  );

  useEffect(() => {
    setPublished((current: CurrentObjectContextView | null) =>
      current?.routeWorkItemId === routeWorkItemId ? current : null,
    );
  }, [routeWorkItemId]);

  const publishCurrentObject = useCallback(
    (view: CurrentObjectContextView | null): void => {
      setPublished(view);
    },
    [],
  );

  const currentObject: CurrentObjectContextView | null =
    routeWorkItemId !== '' && published?.routeWorkItemId === routeWorkItemId
      ? published
      : null;
  const value: CurrentObjectContextValue = useMemo(
    () => ({ currentObject, publishCurrentObject }),
    [currentObject, publishCurrentObject],
  );

  return (
    <CurrentObjectContext.Provider value={value}>
      {children}
    </CurrentObjectContext.Provider>
  );
}

export function useCurrentObjectContext(): CurrentObjectContextValue {
  const value: CurrentObjectContextValue | null =
    useContext(CurrentObjectContext);
  if (!value) {
    throw new Error(
      'useCurrentObjectContext 必须在 CurrentObjectContextProvider 内使用',
    );
  }
  return value;
}
