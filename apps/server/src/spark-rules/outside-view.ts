import type { OutsideChangeView } from '@spark-outpost/contracts';
import { listsDiff } from './rule-diff.ts';
import { NO_RULE_LISTS, parseRulesFile, type RuleLists } from './rules-file.ts';
import type { LoadedRules, RulesFileRead } from './rules-store.ts';

function listsOf(read: RulesFileRead): RuleLists {
  if (read.kind !== 'text') return NO_RULE_LISTS;
  return parseRulesFile(read.text).lists;
}

export function outsideView(loaded: LoadedRules): OutsideChangeView | null {
  if (!loaded.outside) return null;
  const accepted: RulesFileRead =
    loaded.outside.accepted === null
      ? { kind: 'missing' }
      : { kind: 'text', text: loaded.outside.accepted };
  const diff = listsDiff(listsOf(accepted), listsOf(loaded.userFile));
  return { fileHash: loaded.outside.fileHash, added: diff.add, removed: diff.remove };
}
