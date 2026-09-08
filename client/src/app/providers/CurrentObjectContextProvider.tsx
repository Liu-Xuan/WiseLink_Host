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

export type CurrentObjectKind = 'DOCUMENT' | 'WORK_ITEM' | 'MATTER';

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
  routeMatterId?: string;
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

export function currentRouteMatterId(pathname: string): string {
  const match: RegExpMatchArray | null = pathname.match(
    /^\/matters\/([^/]+)(?:\/|$)/u,
  );
  return match?.[1] ? decodeRouteSegment(match[1]) : '';
}

export function currentObjectKindLabel(kind: CurrentObjectKind): string {
  return kind === 'DOCUMENT'
    ? '文档'
    : kind === 'WORK_ITEM'
      ? '评估任务'
      : '工程事项';
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
  const routeMatterId: string = currentRouteMatterId(location.pathname);
  const [published, setPublished] = useState<CurrentObjectContextView | null>(
    null,
  );

  useEffect(() => {
    setPublished((current: CurrentObjectContextView | null) =>
      (
        routeMatterId
          ? current?.routeMatterId === routeMatterId
          : !current?.routeMatterId &&
            current?.routeWorkItemId === routeWorkItemId
      )
        ? current
        : null,
    );
  }, [routeWorkItemId, routeMatterId]);

  const publishCurrentObject = useCallback(
    (view: CurrentObjectContextView | null): void => {
      setPublished(view);
    },
    [],
  );

  const currentObject: CurrentObjectContextView | null = routeMatterId
    ? published?.routeMatterId === routeMatterId
      ? published
      : null
    : routeWorkItemId !== '' &&
        !published?.routeMatterId &&
        published?.routeWorkItemId === routeWorkItemId
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
