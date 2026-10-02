UPDATE task_links SET kind = 'link'
WHERE kind = 'pr' AND source = 'tool_output';
