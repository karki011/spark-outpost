import './mcp-form.css';
import { useId, useState, type FormEvent } from 'react';
import {
  MCP_NAME_PATTERN,
  type McpTransport,
  type SaveUserMcpRequest,
  type UserMcpServer,
} from '@spark-outpost/contracts';
import { countLabel } from '../../ui/count-label.ts';
import { Segmented } from '../../ui/Segmented.tsx';
import { joinCommandLine, splitCommandLine, type SplitResult } from './mcp-command-line.ts';
import { McpPairsField, newPair, type Pair } from './McpPairsField.tsx';
import { McpPasteConfig } from './McpPasteConfig.tsx';
import type { PastedServer } from './mcp-paste.ts';

interface McpServerFormProps {
  server: UserMcpServer | null;
  busy: boolean;
  error: string | null;
  onSave: (body: SaveUserMcpRequest) => void;
  onCancel: () => void;
}

const TRANSPORTS: { id: McpTransport; label: string }[] = [
  { id: 'stdio', label: 'Command' },
  { id: 'http', label: 'HTTP' },
  { id: 'sse', label: 'SSE' },
];

type Field = 'name' | 'command' | 'url';

function initialPairs(server: UserMcpServer | null): Pair[] {
  if (!server) return [];
  const names = server.transport === 'stdio' ? server.envNames : server.headerNames;
  return names.map((name) => newPair(name, '', server.secretNames.includes(name)));
}

function nameProblem(name: string): string | null {
  if (!name.trim()) return 'Enter a name.';
  return MCP_NAME_PATTERN.test(name.trim()) ? null : 'Use letters, numbers, - and _ (up to 64).';
}

function commandProblem(split: SplitResult): string | null {
  if (!split.ok) return split.error;
  return split.parts.length === 0 ? 'Enter the command that starts the server.' : null;
}

function urlProblem(url: string): string | null {
  const parsed = URL.parse(url.trim());
  return parsed && /^https?:$/.test(parsed.protocol) ? null : 'Enter an http:// or https:// URL.';
}

export function McpServerForm({ server, busy, error, onSave, onCancel }: McpServerFormProps) {
  const ids = useId();
  const [name, setName] = useState(server?.name ?? '');
  const [transport, setTransport] = useState<McpTransport>(server?.transport ?? 'stdio');
  const [commandLine, setCommandLine] = useState(
    server?.command ? joinCommandLine([server.command, ...server.args]) : '',
  );
  const [url, setUrl] = useState(server?.url ?? '');
  const [pairs, setPairs] = useState<Pair[]>(() => initialPairs(server));
  const [touched, setTouched] = useState<ReadonlySet<Field>>(new Set());
  const stdio = transport === 'stdio';
  const split = splitCommandLine(commandLine);
  const parts = split.ok ? split.parts : [];
  const problems: Record<Field, string | null> = {
    name: nameProblem(name),
    command: stdio ? commandProblem(split) : null,
    url: stdio ? null : urlProblem(url),
  };
  const valid = Object.values(problems).every((problem) => problem === null);
  const touch = (field: Field) => setTouched((current) => new Set(current).add(field));
  const shown = (field: Field) => (touched.has(field) ? problems[field] : null);
  const describedBy = (field: Field) => (shown(field) ? `${ids}-${field}` : undefined);

  const fill = (pasted: PastedServer) => {
    if (pasted.name) setName(pasted.name);
    setTransport(pasted.transport);
    setCommandLine(pasted.commandLine);
    setUrl(pasted.url);
    setPairs(pasted.values.map((entry) => newPair(entry.name, entry.value)));
    setTouched(new Set(['name', 'command', 'url']));
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setTouched(new Set(['name', 'command', 'url']));
    if (!valid) return;
    const values = Object.fromEntries(
      pairs.filter((pair) => pair.name.trim() !== '').map((pair) => [pair.name.trim(), pair.value]),
    );
    onSave({
      name: name.trim(),
      transport,
      command: stdio ? (parts[0] ?? '') : null,
      args: stdio ? parts.slice(1) : [],
      url: stdio ? null : url.trim(),
      env: stdio ? values : {},
      headers: stdio ? {} : values,
    });
  };

  const fieldError = (field: Field) =>
    shown(field) && (
      <small className="mcp-field-error" id={`${ids}-${field}`}>
        {shown(field)}
      </small>
    );

  return (
    <form className="mcp-form" aria-labelledby={`${ids}-title`} noValidate onSubmit={submit}>
      <div className="mcp-form-head">
        <h4 id={`${ids}-title`}>{server ? `Edit ${server.name}` : 'Add MCP server'}</h4>
        <McpPasteConfig onFill={fill} />
      </div>
      <div className="mcp-form-row">
        <div className="field">
          <label htmlFor={`${ids}-name-input`}>Name</label>
          <input
            id={`${ids}-name-input`}
            className="inp sm mono"
            value={name}
            placeholder="github"
            spellCheck={false}
            aria-invalid={Boolean(shown('name'))}
            aria-describedby={describedBy('name')}
            onBlur={() => touch('name')}
            onChange={(event) => setName(event.target.value)}
          />
          {fieldError('name')}
        </div>
        <div className="field">
          <span aria-hidden="true">Connection</span>
          <Segmented
            ariaLabel="Connection"
            options={TRANSPORTS}
            value={transport}
            onChange={(id) => {
              const next = TRANSPORTS.find((option) => option.id === id);
              if (next) setTransport(next.id);
            }}
          />
        </div>
      </div>
      {stdio ? (
        <div className="field">
          <label htmlFor={`${ids}-command-input`}>Command</label>
          <input
            id={`${ids}-command-input`}
            className="inp sm mono"
            value={commandLine}
            placeholder="npx -y @modelcontextprotocol/server-github"
            spellCheck={false}
            autoComplete="off"
            aria-invalid={Boolean(shown('command'))}
            aria-describedby={describedBy('command')}
            onBlur={() => touch('command')}
            onChange={(event) => setCommandLine(event.target.value)}
          />
          {fieldError('command')}
          {parts.length > 1 && (
            <span className="mcp-parsed" aria-live="polite">
              Runs <code>{parts[0]}</code> with {countLabel(parts.length - 1, 'argument')}
              {parts.slice(1).map((part, index) => (
                <code key={index}>{part || '""'}</code>
              ))}
            </span>
          )}
        </div>
      ) : (
        <div className="field">
          <label htmlFor={`${ids}-url-input`}>URL</label>
          <input
            id={`${ids}-url-input`}
            className="inp sm mono"
            type="url"
            value={url}
            placeholder="https://example.com/mcp"
            spellCheck={false}
            aria-invalid={Boolean(shown('url'))}
            aria-describedby={describedBy('url')}
            onBlur={() => touch('url')}
            onChange={(event) => setUrl(event.target.value)}
          />
          {fieldError('url')}
        </div>
      )}
      <McpPairsField
        legend={stdio ? 'Environment variables' : 'Headers'}
        label={stdio ? 'Environment variable' : 'Header'}
        addLabel={stdio ? 'Add variable' : 'Add header'}
        namePlaceholder={stdio ? 'API_KEY' : 'Authorization'}
        pairs={pairs}
        onChange={setPairs}
      />
      {error && (
        <p className="mcp-error" role="alert">
          {error}
        </p>
      )}
      <div className="mcp-form-foot">
        <button type="button" className="btn ghost sm" onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" className="btn primary sm" disabled={busy || !valid}>
          {server ? 'Save changes' : 'Add server'}
        </button>
      </div>
    </form>
  );
}
