// Custom hook for fetching graph data based on perspective
import { useState, useEffect } from 'react';
import type { GraphData, PerspectiveType } from '../types';

interface UseGraphDataResult {
  data: GraphData | null;
  isLoading: boolean;
  error: Error | null;
}

export function useGraphData(perspective: PerspectiveType): UseGraphDataResult {
  const [data, setData] = useState<GraphData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    // This pre-Suite hook has no matter/work identity and therefore cannot safely
    // read a production graph. Keep the explicit failure for old consumers instead
    // of silently showing mock data or calling the retired relation-graph endpoint.
    setData(null);
    setError(new Error(`旧图谱读取未接通：${perspective} 视角必须从事项图谱入口读取。`));
    setIsLoading(false);
  }, [perspective]);

  return { data, isLoading, error };
}
