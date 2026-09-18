// Custom hook for fetching graph data based on perspective
import { useState, useEffect } from 'react';
import type { GraphData, PerspectiveType } from '../types';
import { MOCK_GRAPH_DATA } from '../data/mockData';

// Environment variable to control data source
const USE_MOCK_DATA = import.meta.env.VITE_USE_MOCK_GRAPH !== 'false';

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
    const fetchData = async () => {
      setIsLoading(true);
      setError(null);

      try {
        if (USE_MOCK_DATA) {
          // Simulate network delay
          await new Promise(resolve => setTimeout(resolve, 300));
          setData(MOCK_GRAPH_DATA[perspective]);
        } else {
          // Real API call
          const response = await fetch(
            `/api/canonical-host/relation-graph?perspective=${perspective}`
          );

          if (!response.ok) {
            throw new Error(`Failed to fetch graph data: ${response.statusText}`);
          }

          const result = await response.json();
          setData(result);
        }
      } catch (err) {
        setError(err instanceof Error ? err : new Error('Unknown error'));
        setData(null);
      } finally {
        setIsLoading(false);
      }
    };

    fetchData();
  }, [perspective]);

  return { data, isLoading, error };
}
