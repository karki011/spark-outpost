import '../spark/spark.css';
import { useId } from 'react';
import type { Profile } from '@spark-outpost/contracts';
import { sparkDesktop } from '../desktop/desktop-bridge.ts';
import { AUTO_REVIEW_ROWS, AutoReviewControls } from '../github/AutoReviewControls.tsx';
import { useGithubInbox } from '../github/use-github-inbox.ts';
import { useRemoteClient } from '../phone/use-remote-client.ts';
import { openSparksPage } from '../sparks-page/sparks-route.ts';
import { Segmented } from '../ui/Segmented.tsx';
import { PULL_REQUEST_ROWS, PullRequestSettings } from './PullRequestSettings.tsx';
import { SettingRow } from './SettingRow.tsx';
import type { SettingsClient } from './settings-sections.tsx';

const SHOW_FROM = 'Show pull requests from';

const WINDOWS = [
  { id: '14', label: 'Last 14 days' },
  { id: '30', label: 'Last 30 days' },
];

export function githubRows({ remote }: SettingsClient): readonly string[] {
  return remote ? PULL_REQUEST_ROWS : [SHOW_FROM, ...AUTO_REVIEW_ROWS, ...PULL_REQUEST_ROWS];
}

function InboxWindowSetting() {
  const hintId = useId();
  const { inbox, windowDays } = useGithubInbox();
  const value = windowDays.isPending ? windowDays.variables : (inbox.data?.windowDays ?? 14);
  const hint = windowDays.isError
    ? `Couldn’t save: ${windowDays.error.message}`
    : 'Counted from the last update on each pull request.';
  return (
    <SettingRow label={SHOW_FROM} hint={hint} hintId={hintId}>
      <Segmented
        ariaLabel={SHOW_FROM}
        describedBy={hintId}
        options={WINDOWS}
        value={String(value)}
        onChange={(id) => windowDays.mutate(id === '30' ? 30 : 14)}
      />
    </SettingRow>
  );
}

function MacOnlyGroups() {
  const openSparks = sparkDesktop()?.settingsWindow ? undefined : () => openSparksPage();
  return (
    <>
      <section className="spark-group" aria-labelledby="github-page-rows">
        <h4 id="github-page-rows">GitHub page</h4>
        <InboxWindowSetting />
      </section>
      <section className="spark-group" aria-labelledby="github-auto-review">
        <h4 id="github-auto-review">Reviews you are asked for</h4>
        <AutoReviewControls onOpenSparks={openSparks} />
      </section>
    </>
  );
}

export function GithubSection({ profile }: { profile: Profile }) {
  const { remote, session } = useRemoteClient();
  const onMac = session !== undefined && !remote;
  return (
    <>
      <p className="lede">
        What the GitHub page shows, who reviews pull requests you are asked to review, and what
        Spark does with the pull requests your chats open.
      </p>
      {onMac ? (
        <MacOnlyGroups />
      ) : (
        <p className="set-hint">The GitHub page and auto-review are set on your Mac.</p>
      )}
      <section className="spark-group" aria-labelledby="github-own-pulls">
        <h4 id="github-own-pulls">Your pull requests</h4>
        <PullRequestSettings profile={profile} />
      </section>
    </>
  );
}
