ALTER TABLE mcp_servers
  ADD COLUMN sign_in text NOT NULL DEFAULT 'none'
    CHECK (sign_in IN ('none', 'needed', 'signed_in'));
