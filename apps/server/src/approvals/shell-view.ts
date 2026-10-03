import type { ApprovalRequest } from './decide.ts';
import { partPlace } from './request-place.ts';
import { partReads, partText, redirectKind, type RedirectKind } from './shell-parts.ts';
import type { ShellScript } from './shell-parse.ts';

export interface ShellView {
  parts: string[];
  reads: boolean[];
  redirects: RedirectKind[];
  unparsed: boolean;
}

export function shellView(request: ApprovalRequest, script: ShellScript | null): ShellView | null {
  if (!script || request.kind !== 'execute' || !request.command) return null;
  const at = partPlace(request);
  const commands = script.commands.filter((command) => command.words.length > 0);
  return {
    parts: commands.map(partText),
    reads: commands.map((command) => partReads(command, at)),
    redirects: script.redirects.map((redirect) => redirectKind(redirect, at)),
    unparsed: script.unknown.length > 0 || commands.length === 0,
  };
}

const HARMLESS_REDIRECTS: ReadonlySet<RedirectKind> = new Set(['quiet', 'reads']);

export function provenRead(view: ShellView | null): boolean {
  if (!view || view.unparsed) return false;
  if (!view.redirects.every((kind) => HARMLESS_REDIRECTS.has(kind))) return false;
  return view.reads.every(Boolean);
}

export function partRequests(request: ApprovalRequest, view: ShellView | null): ApprovalRequest[] {
  if (!view || view.parts.length === 0) return [request];
  return view.parts.map((part) => ({ ...request, command: part }));
}
