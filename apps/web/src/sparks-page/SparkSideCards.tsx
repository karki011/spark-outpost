import { useId } from 'react';
import {
  SPARK_INSTRUCTIONS_FILE,
  type SkillSummary,
  type TeammateView,
} from '@spark-outpost/contracts';
import { ChevronIcon, PlusIcon } from '../ui/icons.tsx';
import { skillFilePath } from './folder-model.ts';
import { wordsLabel } from './spark-usage-model.ts';

const PREVIEW_CHARS = 420;

function preview(text: string): string {
  const trimmed = text.trim();
  return trimmed.length > PREVIEW_CHARS
    ? `${trimmed.slice(0, PREVIEW_CHARS).trimEnd()} …`
    : trimmed;
}

interface InstructionsCardProps {
  spark: TeammateView;
  onEdit: () => void;
}

export function InstructionsCard({ spark, onEdit }: InstructionsCardProps) {
  const titleId = useId();
  const text = spark.instructions;
  return (
    <section className="spk-box" aria-labelledby={titleId}>
      <div className="spk-box-h">
        <h2 id={titleId}>Instructions</h2>
        <span className="spk-box-meta">
          {SPARK_INSTRUCTIONS_FILE} · {wordsLabel(text)}
        </span>
        <button type="button" className="btn ghost sm" onClick={onEdit}>
          Edit<span className="sr-only"> instructions</span>
        </button>
      </div>
      {text.trim() ? (
        <pre className="spk-instr">{preview(text)}</pre>
      ) : (
        <p className="spk-hint">
          No instructions yet. They are added to every chat with this Spark and to every job it is
          handed.
        </p>
      )}
    </section>
  );
}

interface SkillsCardProps {
  skills: readonly SkillSummary[] | undefined;
  onOpen: (path: string) => void;
  onNew: () => void;
}

export function SkillsCard({ skills, onOpen, onNew }: SkillsCardProps) {
  const titleId = useId();
  return (
    <section className="spk-box" aria-labelledby={titleId}>
      <div className="spk-box-h">
        <h2 id={titleId}>Skills</h2>
        <button type="button" className="btn ghost sm" onClick={onNew}>
          <PlusIcon /> New skill
        </button>
      </div>
      {skills && skills.length === 0 && (
        <p className="spk-hint">
          No skills yet. A skill is a set of steps this Spark reads when it needs them.
        </p>
      )}
      {skills && skills.length > 0 && (
        <ul className="spk-rows">
          {skills.map((skill) => (
            <li key={skill.name}>
              <button
                type="button"
                className="spk-row spk-row-btn"
                onClick={() => onOpen(skillFilePath(skill.name))}
              >
                <span className="spk-row-text">
                  <b>{skill.name}</b>
                  <small>{skill.description}</small>
                </span>
                <ChevronIcon />
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
