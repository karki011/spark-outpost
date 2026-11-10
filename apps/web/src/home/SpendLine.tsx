import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { CostText } from '../usage/CostText.tsx';
import { homeApi, homeKeys } from './home-api.ts';

export function SpendLine({ onUsage }: { onUsage: () => void }) {
  const spend = useQuery({
    queryKey: homeKeys.spend('today'),
    queryFn: () => homeApi.spend('today'),
    placeholderData: keepPreviousData,
  });
  const summary = spend.data;
  const unreported = summary !== undefined && summary.costUsd === null && summary.runs > 0;
  return (
    <p className="hspend" aria-busy={spend.isPending}>
      {summary ? (
        <>
          <b>
            <CostText
              usd={summary.costUsd}
              source={summary.costSource}
              empty={unreported ? 'Cost not reported' : '$0.00'}
            />
          </b>{' '}
          {unreported ? 'today' : 'spent today'}
        </>
      ) : (
        <span className="hsk" style={{ width: 120 }} />
      )}
      <span aria-hidden="true"> · </span>
      <button type="button" className="hlink" onClick={onUsage}>
        Usage
      </button>
    </p>
  );
}
