import './sparks-page.css';
import '../teammates/teammates.css';
import '../teammates/teammate-sheet.css';
import { useCallback, useState } from 'react';
import type { Teammate } from '@spark-outpost/contracts';
import { useRemoteClient } from '../phone/use-remote-client.ts';
import { openTeammateSheet, useTeammateCreated } from '../teammates/teammate-store.ts';
import { useTeammates } from '../teammates/use-teammates.ts';
import { DocLink } from '../ui/DocLink.tsx';
import { PlusIcon } from '../ui/icons.tsx';
import { PageTabs } from '../ui/PageTabs.tsx';
import { CrewTab } from './CrewTab.tsx';
import { SparkDetail, type DetailTab } from './SparkDetail.tsx';
import { useSparksPageRequests, type SparksPageRequest } from './sparks-route.ts';
import { useWorkflowCount, WorkflowsTab } from './WorkflowsTab.tsx';

type PageTab = 'crew' | 'workflows';

export function SparksPage() {
  const { loading, error, teammates, starters } = useTeammates();
  const { remote } = useRemoteClient();
  const workflows = useWorkflowCount();
  const [tab, setTab] = useState<PageTab>('crew');
  const [openId, setOpenId] = useState<string | null>(null);
  const [detailTab, setDetailTab] = useState<DetailTab>('details');
  const open = useCallback((sparkId: string | null) => {
    setTab('crew');
    setDetailTab('details');
    setOpenId(sparkId);
  }, []);
  useSparksPageRequests(useCallback((request: SparksPageRequest) => open(request.sparkId), [open]));
  useTeammateCreated(useCallback((created: Teammate) => open(created.id), [open]));
  const spark = teammates.find((entry) => entry.id === openId) ?? null;

  if (spark) {
    return (
      <main className="main sparks" aria-label={`Spark ${spark.name}`}>
        <SparkDetail
          spark={spark}
          tab={detailTab}
          remote={remote}
          onTab={setDetailTab}
          onBack={() => setOpenId(null)}
        />
      </main>
    );
  }
  return (
    <main className="main sparks" aria-labelledby="sparks-title">
      <header className="spk-top">
        <div className="spk-head">
          <div>
            <h1 id="sparks-title">Sparks</h1>
            <p>
              Agents with their own instructions and skills.{' '}
              <DocLink topic="Sparks" doc={{ page: 'sparks' }} />
            </p>
          </div>
          {tab === 'crew' && !remote && teammates.length > 0 && (
            <button
              type="button"
              className="btn primary sm spk-new-spark"
              onClick={() => openTeammateSheet({ kind: 'create' })}
            >
              <PlusIcon /> New Spark
            </button>
          )}
        </div>
        <PageTabs
          ariaLabel="Crew and workflows"
          options={[
            { id: 'crew', label: 'Crew', count: loading ? null : teammates.length },
            { id: 'workflows', label: 'Workflows', count: workflows },
          ]}
          value={tab}
          onChange={(id) => setTab(id as PageTab)}
        />
      </header>
      {tab === 'crew' ? (
        <div className="spk-body" role="tabpanel" aria-label="Crew">
          <CrewTab
            loading={loading}
            error={error}
            sparks={teammates}
            starters={starters}
            remote={remote}
            onOpen={open}
          />
        </div>
      ) : (
        <WorkflowsTab />
      )}
    </main>
  );
}
