DO $$
DECLARE
  pools jsonb := '{
    "scout": ["Pip", "Wren", "Skye"],
    "architect": ["Sketch", "Ada", "Blue"],
    "builder": ["Bolt", "Rivet", "Tack", "Chip", "Nut"],
    "critic": ["Hawk", "Owl", "Lynx"]
  }';
  labels jsonb := '{"scout": "Scout", "architect": "Architect", "builder": "Builder", "critic": "Critic"}';
  legacy text := '^(Scout|Architect|Builder|Critic)( [0-9]+)?$';
  task record;
  member record;
  taken text[];
  pool jsonb;
  size int;
  next_index int;
  candidate text;
BEGIN
  FOR task IN
    SELECT DISTINCT COALESCE(r.task_id, r.parent_run_id, r.id) AS task_key, r.role
    FROM runs r
    WHERE r.role IS NOT NULL AND r.route->>'name' ~ legacy
  LOOP
    pool := pools -> task.role;
    size := jsonb_array_length(pool);
    next_index := 0;
    SELECT COALESCE(array_agg(DISTINCT r.route->>'name'), '{}') INTO taken
    FROM runs r
    WHERE COALESCE(r.task_id, r.parent_run_id, r.id) = task.task_key AND r.role = task.role
      AND r.route->>'name' IS NOT NULL AND r.route->>'name' !~ legacy;
    FOR member IN
      SELECT COALESCE(r.parent_run_id, r.id) AS orchestration_id, r.route->>'name' AS old_name
      FROM runs r
      WHERE COALESCE(r.task_id, r.parent_run_id, r.id) = task.task_key AND r.role = task.role
        AND r.route->>'name' ~ legacy
      GROUP BY 1, 2
      ORDER BY min(r.created_at), 2
    LOOP
      LOOP
        candidate := (pool ->> (next_index % size))
          || CASE WHEN next_index / size > 0 THEN ' ' || (next_index / size + 1) ELSE '' END;
        next_index := next_index + 1;
        EXIT WHEN NOT candidate = ANY (taken);
      END LOOP;
      taken := taken || candidate;
      UPDATE runs r SET
        route = jsonb_set(r.route, '{name}', to_jsonb(candidate)),
        agent_label = CASE
          WHEN r.agent_label IS NULL THEN NULL
          WHEN position(' · ' IN r.agent_label) > 0 THEN
            candidate || ' · ' || (labels ->> task.role)
              || substring(r.agent_label FROM position(' · ' IN r.agent_label))
          ELSE candidate || ' · ' || (labels ->> task.role)
        END
      WHERE COALESCE(r.task_id, r.parent_run_id, r.id) = task.task_key AND r.role = task.role
        AND COALESCE(r.parent_run_id, r.id) = member.orchestration_id
        AND r.route->>'name' = member.old_name;
    END LOOP;
  END LOOP;
END $$;
