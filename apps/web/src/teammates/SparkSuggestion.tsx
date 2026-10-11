import './spark-mention.css';
import { useState } from 'react';
import { SPARK_MENTION_HINT, sparkMentionText, type TeammateView } from '@spark-outpost/contracts';
import { XIcon } from '../ui/icons.tsx';
import { useTooltip } from '../ui/Tooltip.tsx';
import { suggestSpark } from './spark-match.ts';
import { TeammateFace } from './TeammateFace.tsx';

interface SparkSuggestionProps {
  conversationId: string;
  sparks: readonly TeammateView[];
  draft: string;
  onApply: (draft: string) => void;
}

export function SparkSuggestion({ conversationId, sparks, draft, onApply }: SparkSuggestionProps) {
  const [dismissedIn, setDismissedIn] = useState<string | null>(null);
  if (dismissedIn !== null && draft.trim() === '') setDismissedIn(null);
  const quiet = dismissedIn === conversationId;
  const spark = quiet ? null : suggestSpark(draft, sparks);
  const tip = useTooltip(SPARK_MENTION_HINT, { side: 'top' });
  if (!spark) return null;
  const label = spark.role ? `Ask ${spark.name} (${spark.role})?` : `Ask ${spark.name}?`;
  return (
    <span className="spark-suggest" role="group" aria-label="Spark suggestion">
      <button
        type="button"
        className="ctx-repo spark-suggest-apply"
        {...tip.triggerProps}
        onClick={() => onApply(`${sparkMentionText(spark.name)} ${draft.trimStart()}`)}
      >
        <TeammateFace face={spark.face} size={16} />
        <span className="ctx-name">{label}</span>
      </button>
      {tip.tooltip}
      <button
        type="button"
        className="icon-btn spark-suggest-x"
        aria-label={`Dismiss the suggestion to ask ${spark.name}`}
        onClick={() => setDismissedIn(conversationId)}
      >
        <XIcon />
      </button>
    </span>
  );
}
