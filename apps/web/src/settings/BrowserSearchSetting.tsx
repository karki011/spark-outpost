import {
  SEARCH_ENGINES,
  browserSearchEngineSchema,
  type BrowserSearchEngine,
} from '@spark-outpost/contracts';
import { useSearchEngine, useSetSearchEngine } from '../browser-view/search-engine.ts';
import { ChoicePicker } from '../ui/ChoicePicker.tsx';

export const SEARCH_ENGINE_LABEL = 'Search engine';

const ENGINES = browserSearchEngineSchema.options.map((id: BrowserSearchEngine) => ({
  id,
  label: SEARCH_ENGINES[id].label,
}));

export function BrowserSearchSetting() {
  const engine = useSearchEngine();
  const choose = useSetSearchEngine();
  if (!engine) return null;
  return (
    <div className="set-sites" role="group" aria-label={SEARCH_ENGINE_LABEL}>
      <p className="set-hint">
        The Browser view's command bar offers a web search for what you type. Only choosing that row
        sends your text to the engine; nothing is sent while you type.
      </p>
      <ChoicePicker
        label={SEARCH_ENGINE_LABEL}
        choices={ENGINES}
        value={engine}
        onChange={(id) => choose.mutate(browserSearchEngineSchema.parse(id))}
      />
    </div>
  );
}
