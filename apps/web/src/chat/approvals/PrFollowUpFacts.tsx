import type { ReactNode } from 'react';
import { PR_PUSH_ITEM, type PrFollowUpAction, type SparkAction } from '@spark-outpost/contracts';

type RoundAction = Extract<SparkAction, { action: 'pr_follow_up_round' }>;

const FILES_SHOWN = 8;

function Toggle({
  id,
  skip,
  disabled,
  onSkip,
  children,
}: {
  id: string;
  skip: readonly string[];
  disabled: boolean;
  onSkip: (next: string[]) => void;
  children: ReactNode;
}) {
  const checked = !skip.includes(id);
  return (
    <label className="sac-check">
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={() => onSkip(checked ? [...skip, id] : skip.filter((entry) => entry !== id))}
      />
      <span>{children}</span>
    </label>
  );
}

export function PrFollowUpFacts({
  action,
  skip,
  disabled,
  onSkip,
}: {
  action: PrFollowUpAction;
  skip: readonly string[];
  disabled: boolean;
  onSkip: (next: string[]) => void;
}) {
  const push = action.push;
  return (
    <div className="sac-facts sac-pr">
      <p className="sac-pr-head">
        <a href={action.url} target="_blank" rel="noreferrer">
          {action.repo}#{action.number}
        </a>{' '}
        on <code>{action.branch}</code>
      </p>
      <ul className="sac-items" aria-label="Planned actions">
        {push && (
          <li>
            <Toggle id={PR_PUSH_ITEM} skip={skip} disabled={disabled} onSkip={onSkip}>
              <b>Push</b> {push.files.length + push.moreFiles} changed{' '}
              {push.files.length + push.moreFiles === 1 ? 'file' : 'files'} to the PR branch
              <span className="sac-more">
                {' '}
                ({push.files.slice(0, FILES_SHOWN).join(', ')}
                {push.files.length + push.moreFiles > FILES_SHOWN ? ', …' : ''})
              </span>
            </Toggle>
          </li>
        )}
        {action.items.map((item) => (
          <li key={item.id}>
            <Toggle id={item.id} skip={skip} disabled={disabled} onSkip={onSkip}>
              <b>{item.label}</b> {item.author} · {item.where}: {item.what}
              {item.reply && <span className="sac-reply">Reply: “{item.reply}”</span>}
            </Toggle>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function PrRoundFacts({ action }: { action: RoundAction }) {
  return (
    <dl className="sac-facts">
      <dt>Pull request</dt>
      <dd>
        {action.repo}#{action.number}
      </dd>
      <dt>Items</dt>
      <dd>
        <ul className="sac-files">
          {action.items.map((item) => (
            <li key={item.label}>
              <b>{item.label}</b> {item.author}: {item.what}
            </li>
          ))}
        </ul>
      </dd>
    </dl>
  );
}
