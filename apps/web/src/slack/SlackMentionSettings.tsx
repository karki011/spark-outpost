import { useId } from 'react';
import type { SlackConnection } from '@spark-outpost/contracts';
import { Switch } from '../ui/Switch.tsx';
import type { SlackSave } from './use-slack-save.ts';

function slackCanWatchMentions(connection: SlackConnection): boolean {
  if (connection.method === 'sign_in') return connection.member !== null;
  return connection.tokens.user && connection.member !== null;
}

export function SlackMentionSettings({
  connection,
  save,
}: {
  connection: SlackConnection;
  save: SlackSave;
}) {
  const id = useId();
  const usable = slackCanWatchMentions(connection);
  return (
    <section className="sl-section" aria-labelledby={`${id}-title`}>
      <h4 id={`${id}-title`}>Mentions</h4>
      <div className="tk-sync">
        <div>
          <label className="tk-switch">
            <Switch
              size="sm"
              label="Watch for @mentions of me"
              checked={usable && connection.settings.watchMentions}
              disabled={!usable || save.settings.isPending}
              describedBy={`${id}-help`}
              onChange={(next) => save.settings.mutate({ watchMentions: next })}
            />
            <span>Watch for @mentions of me</span>
          </label>
          <p id={`${id}-help`} className="tk-field-help">
            {usable
              ? 'Spark searches Slack for messages that @mention you about once a minute, in any channel you can read, and shows each one on Home with Open in Slack. Direct messages count only where you allowed them. Spark keeps who mentioned you, where and a link, never the message; agents can list recent mentions.'
              : 'Watching for mentions needs Slack sign-in, or your own Slack app with a user token.'}
          </p>
        </div>
      </div>
    </section>
  );
}
