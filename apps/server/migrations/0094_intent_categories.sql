UPDATE runs SET category = CASE category
    WHEN 'debugging' THEN 'bug_fix'
    WHEN 'setup' THEN 'config'
    WHEN 'chat' THEN 'question'
    ELSE category
  END
WHERE category IN ('debugging', 'setup', 'chat');

UPDATE conversations SET title_category = CASE title_category
    WHEN 'debugging' THEN 'bug_fix'
    WHEN 'setup' THEN 'config'
    WHEN 'chat' THEN 'question'
    ELSE title_category
  END
WHERE title_category IN ('debugging', 'setup', 'chat');
