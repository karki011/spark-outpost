import { browserLinksInSchema, type BrowserLinksIn } from '@spark-outpost/contracts';
import { useLinksIn, useSetLinksIn } from '../browser-view/links-in.ts';
import { ChoicePicker } from '../ui/ChoicePicker.tsx';

export const LINKS_IN_LABEL = 'Open links in';

const CHOICES: { id: BrowserLinksIn; label: string }[] = [
  { id: 'spark', label: 'Spark' },
  { id: 'browser', label: 'Default browser' },
];

export function BrowserLinksSetting() {
  const choice = useLinksIn();
  const choose = useSetLinksIn();
  if (!choice) return null;
  return (
    <div className="set-sites" role="group" aria-label={LINKS_IN_LABEL}>
      <p className="set-hint">
        Where a link you click in Spark opens. Spark opens it in a new Browser view tab; a chat's
        links open in its pane. Meeting links and sign-ins always use your default browser.
        Right-click a link to open it in the other one.
      </p>
      <ChoicePicker
        label={LINKS_IN_LABEL}
        choices={CHOICES}
        value={choice}
        onChange={(id) => choose.mutate(browserLinksInSchema.parse(id))}
      />
    </div>
  );
}
