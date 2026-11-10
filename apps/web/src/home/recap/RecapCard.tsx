import './recap.css';
import { useState } from 'react';
import type { RecapBody, RecapSection, RecapVoice } from '@spark-outpost/contracts';
import { Segmented } from '../../ui/Segmented.tsx';
import { HomeCard } from '../HomeCards.tsx';
import { RecapEditor } from './RecapEditor.tsx';
import {
  itemText,
  recapMeta,
  SECTION_EMPTY,
  SECTION_LABELS,
  sectionsFor,
  totalsLine,
  weekRange,
} from './recap-model.ts';
import type { Recap } from './use-recap.ts';

const VOICES = [
  { id: 'me', label: 'For me' },
  { id: 'manager', label: 'For my manager' },
];

const MARKS: Record<RecapSection, string> = { done: '✓', progress: '◐', help: '⚑', you: '•' };

interface SectionProps {
  section: RecapSection;
  body: RecapBody;
  voice: RecapVoice;
  onOpenId: (id: string) => void;
}

function Section({ section, body, voice, onOpenId }: SectionProps) {
  const [all, setAll] = useState(false);
  const items = body[section];
  const shown = all ? items : items.slice(0, 1);
  const headingId = `recap-${section}`;
  return (
    <section className="recap-sec" aria-labelledby={headingId}>
      <h3 id={headingId}>
        <span aria-hidden="true">{MARKS[section]}</span> {SECTION_LABELS[section]}
      </h3>
      {items.length === 0 ? (
        <p className="hnote">{SECTION_EMPTY[section]}</p>
      ) : (
        <ul>
          {shown.map((item, index) => (
            <li key={index}>
              {itemText(item, voice)}
              {item.chatId && (
                <button
                  type="button"
                  className="hlink"
                  aria-label={`Open the chat for: ${itemText(item, voice)}`}
                  onClick={() => onOpenId(item.chatId!)}
                >
                  Open
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {items.length > 1 && (
        <button type="button" className="hlink" aria-expanded={all} onClick={() => setAll(!all)}>
          {all ? 'Show less' : `+ ${items.length - 1} more · Show all`}
        </button>
      )}
    </section>
  );
}

export function RecapCard({ recap, onOpenId }: { recap: Recap; onOpenId: (id: string) => void }) {
  const [voice, setVoice] = useState<RecapVoice>('me');
  const current = recap.recap;
  const body = current?.status === 'ready' ? current.body : null;
  const refresh = (
    <button type="button" className="btn sm line" disabled={recap.writing} onClick={recap.write}>
      {recap.writing ? 'Writing…' : current ? 'Refresh' : 'Write it'}
    </button>
  );
  return (
    <HomeCard id="home-recap" title="Week recap" className="hrecap" action={refresh}>
      <div className="hpanel recap" aria-busy={recap.writing}>
        {current && (
          <p className="recap-sub">
            {weekRange(current)} · {totalsLine(current.totals)}
          </p>
        )}
        {!current && !recap.writing && (
          <p className="hnote">
            See what you got done this week, what is still moving and where someone could help.
          </p>
        )}
        {recap.writing && <p className="hnote">Spark is writing your recap…</p>}
        {current?.status === 'failed' && <p className="home-error">{current.error}</p>}
        {recap.writeError && <p className="home-error">{recap.writeError}</p>}
        {body && current && (
          <>
            <Segmented
              ariaLabel="Recap voice"
              options={VOICES}
              value={voice}
              onChange={(id) => setVoice(id as RecapVoice)}
            />
            {sectionsFor(voice).map((section) => (
              <Section
                key={section}
                section={section}
                body={body}
                voice={voice}
                onOpenId={onOpenId}
              />
            ))}
            <RecapEditor
              key={current.id}
              body={body}
              voice={voice}
              refines={recap.refines}
              rewriting={recap.rewriting}
              refineError={recap.refineError}
              onRefine={(chosen, text, instruction) =>
                recap.refine(current.id, { voice: chosen, text, instruction })
              }
            />
            <p className="recap-meta">{recapMeta(current, recap.refines)}</p>
          </>
        )}
      </div>
    </HomeCard>
  );
}

export function RecapEarly({ recap }: { recap: Recap }) {
  return (
    <HomeCard id="home-recap" title="Week recap" className="hrecap early">
      <div className="hpanel recap">
        <p className="hnote">
          Your recap comes on the day you chose. Want one for the week so far?
        </p>
        <button
          type="button"
          className="btn sm line"
          disabled={recap.writing}
          onClick={recap.write}
        >
          {recap.writing ? 'Writing…' : 'This week so far'}
        </button>
      </div>
    </HomeCard>
  );
}
