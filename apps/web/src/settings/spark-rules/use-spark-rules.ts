import { useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { SparkRules } from '@spark-outpost/contracts';
import { sparkRulesApi, sparkRulesKey } from '../../api/spark-rules.ts';

export function useSparkRules() {
  const rules = useQuery({
    queryKey: sparkRulesKey,
    queryFn: sparkRulesApi.get,
    refetchOnWindowFocus: 'always',
  });
  const { refetch } = rules;
  useEffect(() => {
    const reread = () => void refetch();
    window.addEventListener('focus', reread);
    return () => window.removeEventListener('focus', reread);
  }, [refetch]);
  return rules;
}

export function useRulesWrite<T>(write: (input: T) => Promise<SparkRules>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: write,
    onSuccess: (rules) => queryClient.setQueryData(sparkRulesKey, rules),
  });
}
