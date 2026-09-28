import { useId, useState, type FormEvent } from 'react';
import type { McpTransport, SaveUserMcpRequest, UserMcpServer } from '@spark-outpost/contracts';

interface Pair {
  key: number;
  name: string;
  value: string;
  stored: boolean;
}

interface McpServerFormProps {
  server: UserMcpServer | null;
  busy: boolean;
  error: string | null;
  onSave: (body: SaveUserMcpRequest) => void;
  onCancel: () => void;
}

const TRANSPORTS: { id: McpTransport; label: string }[] = [
  { id: 'stdio', label: 'Command (stdio)' },
  { id: 'http', label: 'HTTP' },
  { id: 'sse', label: 'SSE' },
];

let nextKey = 0;

function initialPairs(server: UserMcpServer | null): Pair[] {
  if (!server) return [];
  const names = server.transport === 'stdio' ? server.envNames : server.headerNames;
  return names.map((name) => ({
    key: nextKey++,
    name,
    value: '',
    stored: server.secretNames.includes(name),
  }));
}

export function McpServerForm({ server, busy, error, onSave, onCancel }: McpServerFormProps) {
  const formId = useId();
  const [name, setName] = useState(server?.name ?? '');
  const [transport, setTransport] = useState<McpTransport>(server?.transport ?? 'stdio');
  const [command, setCommand] = useState(server?.command ?? '');
  const [args, setArgs] = useState(server?.args.join('\n') ?? '');
  const [url, setUrl] = useState(server?.url ?? '');
  const [pairs, setPairs] = useState<Pair[]>(() => initialPairs(server));
  const stdio = transport === 'stdio';
  const pairLabel = stdio ? 'Environment variable' : 'Header';

  const update = (key: number, change: Partial<Pair>) =>
    setPairs((current) =>
      current.map((pair) => (pair.key === key ? { ...pair, ...change } : pair)),
    );

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const values = Object.fromEntries(
      pairs.filter((pair) => pair.name.trim() !== '').map((pair) => [pair.name.trim(), pair.value]),
    );
    onSave({
      name: name.trim(),
      transport,
      command: stdio ? command.trim() : null,
      args: stdio ? args.split('\n').filter((arg) => arg.trim() !== '') : [],
      url: stdio ? null : url.trim(),
      env: stdio ? values : {},
      headers: stdio ? {} : values,
    });
  };

  return (
    <form
      className="mcp-form"
      aria-label={server ? `Edit ${server.name}` : 'Add an MCP server'}
      onSubmit={submit}
    >
      <label className="field">
        <span>Name</span>
        <input
          className="inp"
          value={name}
          required
          pattern="[A-Za-z0-9_\-]{1,64}"
          title="Letters, numbers, - and _"
          onChange={(event) => setName(event.target.value)}
        />
      </label>
      <div className="field" role="radiogroup" aria-label="Connection">
        <span>Connection</span>
        <div className="mcp-seg">
          {TRANSPORTS.map((option) => (
            <button
              key={option.id}
              type="button"
              role="radio"
              aria-checked={transport === option.id}
              onClick={() => setTransport(option.id)}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>
      {stdio ? (
        <>
          <label className="field">
            <span>Command</span>
            <input
              className="inp"
              value={command}
              required
              placeholder="npx"
              onChange={(event) => setCommand(event.target.value)}
            />
          </label>
          <label className="field">
            <span>Arguments, one per line</span>
            <textarea
              className="inp mcp-args"
              rows={3}
              value={args}
              onChange={(event) => setArgs(event.target.value)}
            />
          </label>
        </>
      ) : (
        <label className="field">
          <span>URL</span>
          <input
            className="inp"
            type="url"
            value={url}
            required
            placeholder="https://example.com/mcp"
            onChange={(event) => setUrl(event.target.value)}
          />
        </label>
      )}
      <fieldset className="mcp-pairs">
        <legend>{stdio ? 'Environment variables' : 'Headers'}</legend>
        <p className="set-hint">
          Values are saved in your keychain, never in the database or logs.
        </p>
        {pairs.map((pair, index) => (
          <div key={pair.key} className="mcp-pair">
            <input
              className="inp"
              aria-label={`${pairLabel} ${index + 1} name`}
              value={pair.name}
              onChange={(event) => update(pair.key, { name: event.target.value })}
            />
            <input
              className="inp"
              type="password"
              autoComplete="off"
              aria-label={`${pairLabel} ${index + 1} value`}
              placeholder={pair.stored ? 'Saved in keychain; blank keeps it' : 'Value'}
              value={pair.value}
              onChange={(event) => update(pair.key, { value: event.target.value })}
            />
            <button
              type="button"
              className="btn ghost sm"
              aria-label={`Remove ${pairLabel.toLowerCase()} ${pair.name || index + 1}`}
              onClick={() => setPairs((current) => current.filter((item) => item.key !== pair.key))}
            >
              Remove
            </button>
          </div>
        ))}
        <button
          type="button"
          className="btn line sm"
          onClick={() =>
            setPairs((current) => [
              ...current,
              { key: nextKey++, name: '', value: '', stored: false },
            ])
          }
        >
          Add {pairLabel.toLowerCase()}
        </button>
      </fieldset>
      {error && (
        <p className="mcp-error" role="alert" id={`${formId}-error`}>
          {error}
        </p>
      )}
      <div className="mcp-actions">
        <button type="submit" className="btn primary sm" disabled={busy}>
          {server ? 'Save changes' : 'Add server'}
        </button>
        <button type="button" className="btn ghost sm" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}
