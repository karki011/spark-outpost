import { RULES_FILE_NAMES, type RulesEditAction } from '@spark-outpost/contracts';
import { managedWriteFor } from '../../spark-rules/managed-writer.ts';
import { diffLine, ruleChangeOf } from '../../spark-rules/rule-diff.ts';
import {
  changeManagedRules,
  changeSparkRules,
  sparkRulesFiles,
} from '../../spark-rules/rules-store.ts';
import type { Performed } from './performed.ts';

export async function performRulesEdit(action: RulesEditAction): Promise<Performed> {
  const files = sparkRulesFiles();
  const change = ruleChangeOf(action);
  if (action.target === 'managed') {
    await changeManagedRules(files, change, action.fileHash, managedWriteFor(files.managed));
  } else {
    await changeSparkRules(files, () => change, action.fileHash);
  }
  return { message: `Changed ${RULES_FILE_NAMES[action.target]}: ${diffLine(action)}.`, url: null };
}
