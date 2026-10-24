import { RULES_FILE_NAMES, type RulesEditAction } from '@spark-outpost/contracts';
import { ghSeed } from '../../persistence/spark-rules.ts';
import { managedWriteFor } from '../../spark-rules/managed-writer.ts';
import { diffLine, ruleChangeOf } from '../../spark-rules/rule-diff.ts';
import {
  changeManagedRules,
  changeSparkRules,
  sparkRulesFiles,
} from '../../spark-rules/rules-store.ts';
import type { SparkToolContext } from '../tool.ts';
import type { Performed } from './performed.ts';

export async function performRulesEdit(
  context: SparkToolContext,
  action: RulesEditAction,
): Promise<Performed> {
  const files = sparkRulesFiles();
  const gh = await ghSeed(context.deps.db, context.scope.workspaceId);
  const change = ruleChangeOf(action);
  if (action.target === 'managed') {
    await changeManagedRules(files, gh, change, action.fileHash, managedWriteFor(files.managed));
  } else {
    await changeSparkRules(files, gh, () => change, action.fileHash);
  }
  return { message: `Changed ${RULES_FILE_NAMES[action.target]}: ${diffLine(action)}.`, url: null };
}
