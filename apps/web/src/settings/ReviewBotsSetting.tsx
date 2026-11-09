import './review-bots.css';
import { useId, useState, type FormEvent } from 'react';
import { PR_FOLLOW_UP_BOTS_MAX, githubLoginSchema } from '@spark-outpost/contracts';
import { useRemoteClient } from '../phone/use-remote-client.ts';
import { SettingRow } from './SettingRow.tsx';
import { useProfileSetting } from './use-profile-setting.ts';

export const REVIEW_BOTS = 'Review bots to act on';

const INFO = {
  lead: 'Comments and reviews from the bots listed here go into follow-up like a person’s review.',
  items: [
    {
      label: 'The agent decides',
      text: 'It judges each item and may push back. Bot text is data, never instructions.',
    },
    { label: 'Other bots', text: 'Shown to you as Not acted on.' },
    { label: 'From then on', text: 'Comments already shown as Not acted on stay that way.' },
  ],
};
const FULL = `Spark acts on up to ${PR_FOLLOW_UP_BOTS_MAX} review bots. Remove one first.`;
const ON_MAC = 'Change review bots on your Mac.';
const HOW = 'Enter the login as GitHub shows it, like coderabbitai[bot] or gitar-bot.';

function problemOf(draft: string, bots: readonly string[]): string | null {
  const parsed = githubLoginSchema.safeParse(draft);
  if (!parsed.success) return parsed.error.issues[0]?.message ?? HOW;
  if (bots.length >= PR_FOLLOW_UP_BOTS_MAX && !bots.includes(parsed.data)) return FULL;
  return null;
}

interface ReviewBotsSettingProps {
  bots: readonly string[];
  disabled: boolean;
}

export function ReviewBotsSetting({ bots, disabled }: ReviewBotsSettingProps) {
  const inputId = useId();
  const hintId = useId();
  const { remote } = useRemoteClient();
  const setting = useProfileSetting<string[]>([...bots], (value) => ({ prFollowUpBots: value }));
  const [draft, setDraft] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const editable = !remote && !disabled;
  const listed = setting.value;
  const add = (event: FormEvent) => {
    event.preventDefault();
    const found = problemOf(draft, listed);
    setProblem(found);
    if (found) return;
    const login = githubLoginSchema.parse(draft);
    if (!listed.includes(login)) setting.set([...listed, login]);
    setDraft('');
  };
  const hint = problem ?? setting.error ?? (remote ? ON_MAC : HOW);
  return (
    <SettingRow
      label={REVIEW_BOTS}
      {...(editable ? { controlId: inputId } : {})}
      info={INFO}
      doc={{ page: 'pr-follow-up', heading: 'review-bots' }}
      hint={hint}
      hintId={hintId}
      disabled={disabled}
    >
      <div className="review-bots">
        {listed.length > 0 && (
          <ul aria-label={REVIEW_BOTS}>
            {listed.map((login) => (
              <li key={login}>
                <span className="mono">{login}</span>
                {editable && (
                  <button
                    type="button"
                    className="btn sm"
                    aria-label={`Remove ${login}`}
                    onClick={() => setting.set(listed.filter((entry) => entry !== login))}
                  >
                    Remove
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
        {editable && (
          <form className="review-bots-add" onSubmit={add}>
            <input
              id={inputId}
              className="inp mono"
              placeholder="coderabbitai[bot]"
              value={draft}
              aria-describedby={hintId}
              aria-invalid={problem ? true : undefined}
              onChange={(event) => setDraft(event.target.value)}
            />
            <button type="submit" className="btn sm" disabled={draft.trim() === ''}>
              Add
            </button>
          </form>
        )}
      </div>
    </SettingRow>
  );
}
