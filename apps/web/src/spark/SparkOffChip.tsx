import './spark.css';
import { useQuery } from '@tanstack/react-query';
import { setupApi, setupKey } from '../api/setup.ts';
import { BlobScout } from '../brand/BlobScout.tsx';
import { requestSettings } from '../settings/settings-request.ts';

export function SparkOffChip() {
  const setup = useQuery({ queryKey: setupKey, queryFn: setupApi.get });
  if (setup.data?.profile.sparkEnabled !== false) return null;
  return (
    <button
      type="button"
      className="spark-off"
      title="Chats go straight to the agent you pick. Open Spark settings to turn Spark on."
      onClick={() => requestSettings('spark')}
    >
      <BlobScout size={16} mood="sleep" />
      Spark off
    </button>
  );
}
