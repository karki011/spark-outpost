const ANSWERED_BY_TMUX =
  // eslint-disable-next-line no-control-regex
  /\x1b\[(?:>?0?c|[56]n|\?996n|\??[0-9]+\$p|>0?q)|\x1b\]1[01];\?(?:\x07|\x1b\\)/g;
// eslint-disable-next-line no-control-regex
const UNFINISHED = /^\x1b(?:\[[0-9;?>$]*|\](?:1(?:[01](?:;(?:\?\x1b?)?)?)?)?)?$/;
const LONGEST_UNFINISHED = 16;

function unfinishedFrom(text: string): number {
  const earliest = Math.max(0, text.length - LONGEST_UNFINISHED);
  for (let index = text.indexOf('\x1b', earliest); index !== -1;) {
    if (UNFINISHED.test(text.slice(index))) return index;
    index = text.indexOf('\x1b', index + 1);
  }
  return text.length;
}

export function createAnsweredQueryFilter(): (text: string) => string {
  let held = '';
  return (text) => {
    const cleaned = (held + text).replace(ANSWERED_BY_TMUX, '');
    const cut = unfinishedFrom(cleaned);
    held = cleaned.slice(cut);
    return cleaned.slice(0, cut);
  };
}
