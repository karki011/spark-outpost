import { NEEDS_YOU_PREFIX } from '@spark-outpost/contracts';
import { workReply } from './work-reply.ts';

export const summaryQuery = `
  SELECT c.id, c.title, c.updated_at, c.archived_at, c.pinned_at, c.pinned_order, c.title_source,
    tm.id AS teammate_id, tm.name AS teammate_name, tm.role AS teammate_role,
    tm.face_shape AS teammate_shape, tm.face_color AS teammate_color,
    COALESCE(
      (SELECT cr.category FROM runs cr
       WHERE cr.conversation_id = c.id AND cr.parent_run_id IS NULL
         AND cr.category IS NOT NULL AND cr.category <> 'question'
       ORDER BY cr.created_at DESC LIMIT 1),
      (SELECT cr.category FROM runs cr
       WHERE cr.conversation_id = c.id AND cr.parent_run_id IS NULL AND cr.category = 'question'
       LIMIT 1)
    ) AS category,
    r.id AS latest_run_id, r.status AS latest_run_status, r.error AS latest_run_error,
    r.provider AS latest_run_provider, r.interruption_choice AS latest_run_interruption_choice,
    CASE WHEN r.status IN ('queued', 'running') THEN (
      SELECT jsonb_build_object(
        'done', count(*) FILTER (WHERE entry->>'status' = 'completed'),
        'active', count(*) FILTER (WHERE entry->>'status' = 'in_progress'),
        'total', count(*))
      FROM (
        SELECT body FROM run_artifacts
        WHERE task_id = r.task_id AND kind = 'plan' ORDER BY version DESC LIMIT 1
      ) plan, jsonb_array_elements(plan.body->'entries') entry
      WHERE btrim(entry->>'content') <> ''
    ) END AS latest_run_progress,
    CASE WHEN r.status = 'running' THEN (
      SELECT e.payload->>'stepName' FROM run_events e
      WHERE e.run_id = r.id AND e.type = 'STEP_STARTED' AND NOT (e.payload ? 'subagentRunId')
      ORDER BY e.seq DESC LIMIT 1
    ) END AS latest_run_step,
    CASE WHEN r.status = 'running' THEN (
      SELECT (e.payload->'content'->>'waitingOn')::int FROM run_events e
      WHERE e.run_id = r.id AND e.type = 'ACTIVITY_SNAPSHOT'
        AND e.payload->>'activityType' = 'subagents'
      ORDER BY e.seq DESC LIMIT 1
    ) END AS latest_run_waiting_on,
    CASE WHEN r.status = 'succeeded' THEN (
      SELECT CASE WHEN strpos(work.text, '${NEEDS_YOU_PREFIX}') > 0 THEN work.text END
      FROM (${workReply('r.id', 'm.content')}) work
    ) END AS latest_run_asking_reply,
    COALESCE(
      r.status = 'succeeded' AND r.finished_at > COALESCE(c.seen_at, '-infinity'::timestamptz),
      false
    ) AS unread,
    c.seen_at, r.finished_at AS latest_run_finished_at,
    COALESCE(p.pending_created_at, fl.flag_created_at) AS waiting_since,
    COALESCE(
      r.status = 'awaiting_approval' OR p.pending_id IS NOT NULL OR fl.flag_id IS NOT NULL, false
    ) AS needs_input,
    fl.flag_title,
    COALESCE((
      SELECT bool_or(w.pr_state = 'merged') AND NOT bool_or(w.pr_state = 'open')
      FROM pr_watches w WHERE w.conversation_id = c.id
    ), false) AS pull_request_merged,
    p.pending_id, p.pending_kind, p.pending_title, p.pending_command, p.pending_paths,
    p.pending_agent, p.pending_member, p.pending_asker, p.pending_subagent, p.pending_questions,
    p.pending_plan,
    p.pending_provider, p.pending_pr_feedback,
    om.outpost_id, ob.name AS outpost_name, om.handle AS outpost_handle,
    ARRAY(
      SELECT cp.project_id::text FROM conversation_projects cp
      WHERE cp.conversation_id = c.id ORDER BY cp.position, cp.created_at
    ) AS project_ids,
    (SELECT cp.sort_order FROM conversation_projects cp
     WHERE cp.conversation_id = c.id ORDER BY cp.position, cp.created_at LIMIT 1) AS project_order
  FROM conversations c
  LEFT JOIN teammates tm ON tm.id = c.teammate_id
  LEFT JOIN outpost_members om ON om.conversation_id = c.id
  LEFT JOIN outposts ob ON ob.id = om.outpost_id
  LEFT JOIN LATERAL (
    SELECT id, status, error, finished_at, provider, task_id, interruption_choice FROM runs
    WHERE conversation_id = c.id AND parent_run_id IS NULL ORDER BY created_at DESC LIMIT 1
  ) r ON true
  LEFT JOIN LATERAL (
    SELECT a.id AS pending_id, a.created_at AS pending_created_at, a.kind AS pending_kind,
      a.title AS pending_title,
      a.payload->>'command' AS pending_command, a.payload->'paths' AS pending_paths,
      CASE WHEN ar.parent_run_id IS NOT NULL THEN ar.route->>'name' END AS pending_agent,
      m.name AS pending_member, a.payload->'checkpoint'->>'agent' AS pending_asker,
      a.payload->>'subagent' AS pending_subagent,
      a.payload->'checkpoint'->'questions'->0 IS NOT NULL AS pending_questions,
      a.payload->>'plan' IS NOT NULL AS pending_plan,
      COALESCE(m.provider, ar.provider) AS pending_provider,
      a.payload->'sparkAction'->>'action' = 'pr_follow_up' AS pending_pr_feedback
    FROM approvals a
    JOIN runs ar ON ar.id = a.run_id
    LEFT JOIN LATERAL (
      SELECT mr.route->>'name' AS name, mr.provider FROM runs mr
      WHERE mr.parent_run_id = r.id AND mr.route->>'name' IS NOT NULL
        AND mr.role = CASE a.kind WHEN 'plan' THEN 'architect' WHEN 'accept' THEN 'builder' END
      ORDER BY mr.created_at DESC LIMIT 1
    ) m ON true
    WHERE a.status = 'pending' AND (ar.id = r.id OR ar.parent_run_id = r.id)
    ORDER BY a.created_at, a.id LIMIT 1
  ) p ON true
  LEFT JOIN LATERAL (
    SELECT f.id AS flag_id, f.title AS flag_title, f.created_at AS flag_created_at
    FROM rail_flags f
    WHERE f.conversation_id = c.id AND f.status = 'open'
    ORDER BY f.created_at DESC LIMIT 1
  ) fl ON true`;
