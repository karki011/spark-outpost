import './spark-rules.css';
import type { SetSparkRuleRequest, SparkRules } from '@spark-outpost/contracts';
import { sparkRulesApi } from '../../api/spark-rules.ts';
import { useRemoteClient } from '../../phone/use-remote-client.ts';
import { LockIcon } from '../../ui/icons.tsx';
import { QueryWait } from '../../ui/loading/QueryWait.tsx';
import { Skeleton } from '../../ui/loading/Skeleton.tsx';
import { GhAllowedList } from './GhAllowedList.tsx';
import { MERGE_LABEL, RULE_GROUPS } from './rule-rows.ts';
import { FixedChoice, RuleLine, RuleRow, SourceTag } from './RuleRow.tsx';
import { RulesActions } from './RulesActions.tsx';
import { RulesFileProblems, UnusedEntries } from './UnusedEntries.tsx';
import { useRulesWrite, useSparkRules } from './use-spark-rules.ts';

const MERGE_IDS = ['gh pr merge', 'gh pr review --approve', '--admin'];
const ON_THE_MAC = 'Spark rules change on the Mac.';

function RuleGroups({ rules, editable }: { rules: SparkRules; editable: boolean }) {
  const save = useRulesWrite((change: SetSparkRuleRequest) => sparkRulesApi.setRule(change));
  const stateOf = (row: string) => rules.rows.find((state) => state.row === row);
  return (
    <>
      {save.error && (
        <p className="set-hint rules-error" role="alert">
          {save.error.message}
        </p>
      )}
      {RULE_GROUPS.map((group) => (
        <section key={group.id} className="rules-group" aria-labelledby={`rules-${group.id}`}>
          <h4 id={`rules-${group.id}`}>{group.title}</h4>
          {group.rows.map((copy) => {
            const state = stateOf(copy.row);
            return (
              state && (
                <RuleRow
                  key={copy.row}
                  copy={copy}
                  state={state}
                  editable={editable}
                  onChange={(choice) => save.mutate({ row: copy.row, choice })}
                />
              )
            );
          })}
          {group.id === 'github' && (
            <>
              <RuleLine label={MERGE_LABEL} ids={MERGE_IDS}>
                <SourceTag source="fixed" />
                <FixedChoice label="Refuse" choice="deny" />
              </RuleLine>
              <GhAllowedList entries={rules.ghAllowed} editable={editable} />
            </>
          )}
        </section>
      ))}
    </>
  );
}

function RulesPage({ rules }: { rules: SparkRules }) {
  const { remote } = useRemoteClient();
  const editable = !remote && !rules.malformed;
  return (
    <>
      {remote ? (
        <p className="set-hint">{ON_THE_MAC}</p>
      ) : (
        <RulesActions malformed={rules.malformed} />
      )}
      <RulesFileProblems rules={rules} />
      <RuleGroups rules={rules} editable={editable} />
      <UnusedEntries rules={rules} />
      <p className="rules-kept">
        <LockIcon />
        <span>
          Always kept, so an agent can&apos;t give itself more: agents never edit these settings
          files and never reach Spark&apos;s own ports.
        </span>
      </p>
    </>
  );
}

export function SparkRulesSection() {
  const rules = useSparkRules();
  return (
    <>
      <p className="lede">
        Nothing set means the agent&apos;s mode decides, like any other tool. Set a rule to allow,
        ask or refuse it in every mode.
      </p>
      <QueryWait query={rules} what="Spark rules">
        <Skeleton label="Loading Spark rules" rows={6} />
      </QueryWait>
      {rules.data && <RulesPage rules={rules.data} />}
    </>
  );
}
