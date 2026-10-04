import { touchesUi } from '@spark-outpost/contracts';
import { namedFiles } from '../orchestration/context.ts';

export const BROWSER_CHECK_LINE =
  "This task looks like it changes the interface. After editing, open the app in Spark's browser (spark_browser_open with no url opens the project's preview), read the page and take a screenshot to confirm the change. This is a suggestion, not a requirement.";

export interface BrowserCheckTurn {
  prompt: string;
  userRequest: string;
  editsFiles: boolean;
  browserPane: boolean;
}

export function suggestsBrowserCheck(turn: BrowserCheckTurn): boolean {
  if (!turn.browserPane || !turn.editsFiles) return false;
  return touchesUi(turn.userRequest, namedFiles([turn.prompt]));
}

export function withBrowserCheck(turn: BrowserCheckTurn): string {
  return suggestsBrowserCheck(turn) ? `${turn.prompt}\n\n${BROWSER_CHECK_LINE}` : turn.prompt;
}
