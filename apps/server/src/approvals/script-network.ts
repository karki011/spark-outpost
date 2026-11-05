import { codeHosts, remoteHosts } from './egress-hosts.ts';

const NETWORK_CODE =
  /\b(?:requests|httpx|aiohttp|urllib\d?|urlopen|http\.client|socket|smtplib|ftplib|telnetlib|imaplib|poplib|xmlrpc|pycurl|paramiko|websockets?|XMLHttpRequest|WebSocket|axios|undici|node-fetch|EventSource|sendBeacon|dgram|Net::HTTP|open-uri|HTTParty|Faraday|LWP|IO::Socket|HTTP::Tiny|curl_exec|curl_init|fsockopen|stream_socket_client)\b|\b(?:from|import)\s+http\b|\bfetch\s*\(|\bhttps?\.(?:request|get)\s*\(|\bnet\.(?:connect|createConnection|Socket)\b|\btls\.connect\b|\b(?:Deno|Bun)\.connect\b|\/inet\/|\/dev\/(?:tcp|udp)\//;
const SPAWNS =
  /\b(?:subprocess|child_process|os\.(?:system|popen|exec\w*|spawn\w*|posix_spawn\w*)|pty\.spawn|execSync|spawnSync|execFileSync|execFile|spawn|popen|system|shell_exec|passthru|proc_open|Open3|qx|Deno\.Command|Bun\.spawn)\b/;
const NETWORK_PROGRAM = /\b(?:curl|wget|nc|ncat|netcat|ssh|scp|sftp|rsync|telnet)\b/;
const PYTHON_DYNAMIC =
  /\b(?:exec|eval|__import__|importlib|builtins|__builtins__)\b|(?<![.\w])compile\s*\(/;
const PYTHON_NETWORK_MODULES =
  'requests|httpx|aiohttp|urllib\\d?|http|socket|smtplib|ftplib|telnetlib|imaplib|poplib|xmlrpc|pycurl|paramiko|websockets?';
const PYTHON_NETWORK = new RegExp(
  `^\\s*(?:import|from)\\s[^\\n]*\\b(?:${PYTHON_NETWORK_MODULES})\\b|\\b(?:${PYTHON_NETWORK_MODULES}|urlopen)(?:\\.\\w+)*\\s*\\(`,
  'm',
);
const CALL_CHARS = 2_000;
const FORMATTED_PREFIX = /(?<!\w)[rRbBuU]?[fF][rR]?$/;

function stringEnd(code: string, from: number, quote: string): number | null {
  const multiline = quote.length === 3;
  for (let index = from; index < code.length; index++) {
    const char = code[index]!;
    if (char === '\\') index += 1;
    else if (char === '\n' && !multiline) return null;
    else if (code.startsWith(quote, index)) return index;
  }
  return null;
}

export function pythonLogic(code: string): string | null {
  let logic = '';
  for (let index = 0; index < code.length; index++) {
    const char = code[index]!;
    if (char === '#') {
      const lineEnd = code.indexOf('\n', index);
      index = (lineEnd === -1 ? code.length : lineEnd) - 1;
      continue;
    }
    if (char !== '"' && char !== "'") {
      logic += char;
      continue;
    }
    const quote = code.startsWith(char.repeat(3), index) ? char.repeat(3) : char;
    const end = stringEnd(code, index + quote.length, quote);
    if (end === null) return null;
    const formatted = FORMATTED_PREFIX.test(code.slice(Math.max(0, index - 3), index));
    logic += formatted ? code.slice(index, end + quote.length) : `${quote}${quote}`;
    index = end + quote.length - 1;
  }
  return logic;
}

function spawnCalls(code: string): string {
  const calls = [...code.matchAll(new RegExp(SPAWNS.source, 'g'))].map((match) => {
    const open = code.indexOf('(', match.index);
    const close = open === -1 ? -1 : code.indexOf(')', open);
    return close === -1 ? code : code.slice(match.index, Math.min(close, open + CALL_CHARS));
  });
  return calls.join('\n');
}

function spawnsNetwork(code: string): boolean {
  const spawned = spawnCalls(code);
  return NETWORK_PROGRAM.test(spawned) || remoteHosts(codeHosts(spawned)).length > 0;
}

function pythonUsesNetwork(code: string): boolean | null {
  const logic = pythonLogic(code);
  if (logic === null || PYTHON_DYNAMIC.test(logic)) return null;
  return PYTHON_NETWORK.test(logic) || (SPAWNS.test(logic) && spawnsNetwork(code));
}

export function usesNetwork(code: string, python: boolean): boolean {
  const known = python ? pythonUsesNetwork(code) : null;
  if (known !== null) return known;
  if (NETWORK_CODE.test(code)) return true;
  return SPAWNS.test(code) && spawnsNetwork(code);
}
