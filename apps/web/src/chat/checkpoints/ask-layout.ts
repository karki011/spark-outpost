export type AskLayout = 'list' | 'steps';

export const ASK_LAYOUT_KEY = 'spark-outpost.ask-card';

export function askLayout(): AskLayout {
  try {
    return localStorage.getItem(ASK_LAYOUT_KEY) === 'steps' ? 'steps' : 'list';
  } catch {
    return 'list';
  }
}
