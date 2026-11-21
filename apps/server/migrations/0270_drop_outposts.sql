UPDATE runs r SET source = 'queue'
FROM outpost_posts p
WHERE r.source = 'outpost' AND p.id = r.user_message_id AND p.from_user;

UPDATE runs SET source = 'chat' WHERE source = 'outpost';

ALTER TABLE runs DROP CONSTRAINT IF EXISTS runs_source_check;
ALTER TABLE runs
  ADD CONSTRAINT runs_source_check
  CHECK (source IN (
    'ui', 'e2e', 'bench', 'digest', 'ticket', 'pr_follow_up', 'queue', 'slack',
    'agent_cycle', 'spark_rule', 'voice', 'assistant', 'pages', 'workflow', 'chat'
  ));

DELETE FROM attention_marks m
USING approvals a
WHERE m.key = 'approval:' || a.id
  AND (a.payload->'sparkAction'->>'action' = 'start_outpost'
    OR (a.payload->'sparkAction'->>'action' = 'ask_spark'
      AND a.payload->'sparkAction'->>'op' = 'post_outpost'));

DELETE FROM approvals a
WHERE a.payload->'sparkAction'->>'action' = 'start_outpost'
   OR (a.payload->'sparkAction'->>'action' = 'ask_spark'
     AND a.payload->'sparkAction'->>'op' = 'post_outpost');

DELETE FROM chat_queue WHERE outpost_post_id IS NOT NULL;
ALTER TABLE chat_queue DROP COLUMN outpost_post_id;

DROP TRIGGER IF EXISTS runs_insert_outpost_change ON runs;
DROP TRIGGER IF EXISTS runs_status_outpost_change ON runs;
DROP TRIGGER IF EXISTS pr_watches_insert_outpost_change ON pr_watches;
DROP TRIGGER IF EXISTS pr_watches_state_outpost_change ON pr_watches;

DROP TABLE outpost_story_tasks, outpost_drafts, outpost_posts, outpost_members, outposts;

DROP FUNCTION outpost_story_task_changed();
DROP FUNCTION outpost_pull_changed();
DROP FUNCTION outpost_post_changed();
DROP FUNCTION outpost_run_changed();
DROP FUNCTION notify_outpost_changed(uuid);
