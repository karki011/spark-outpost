import { useId, useState } from 'react';
import { parsePastedServer, type PastedServer } from './mcp-paste.ts';

export function McpPasteConfig({ onFill }: { onFill: (server: PastedServer) => void }) {
  const ids = useId();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [problem, setProblem] = useState<string | null>(null);

  const apply = () => {
    const result = parsePastedServer(text);
    if (!result.ok) {
      setProblem(result.error);
      return;
    }
    onFill(result.server);
    setOpen(false);
    setText('');
    setProblem(null);
  };

  return (
    <>
      <button
        type="button"
        className="mcp-text-btn"
        aria-expanded={open}
        aria-controls={`${ids}-paste`}
        onClick={() => setOpen(!open)}
      >
        Paste config
      </button>
      {open && (
        <div className="mcp-paste" id={`${ids}-paste`}>
          <label htmlFor={`${ids}-text`}>Server JSON from a README</label>
          <textarea
            id={`${ids}-text`}
            className="inp sm mono"
            rows={4}
            spellCheck={false}
            placeholder='{ "mcpServers": { "github": { "command": "npx", "args": ["-y", "…"] } } }'
            aria-invalid={Boolean(problem)}
            aria-describedby={problem ? `${ids}-problem` : undefined}
            value={text}
            onChange={(event) => setText(event.target.value)}
          />
          {problem && (
            <small className="mcp-field-error" id={`${ids}-problem`}>
              {problem}
            </small>
          )}
          <div className="mcp-form-foot">
            <button type="button" className="btn ghost sm" onClick={() => setOpen(false)}>
              Cancel
            </button>
            <button type="button" className="btn line sm" disabled={!text.trim()} onClick={apply}>
              Fill the form
            </button>
          </div>
        </div>
      )}
    </>
  );
}
