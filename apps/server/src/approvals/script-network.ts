import { codeHosts, remoteHosts } from './egress-hosts.ts';

const NETWORK_CODE =
  /\b(?:requests|httpx|aiohttp|urllib\d?|urlopen|http\.client|socket|smtplib|ftplib|telnetlib|imaplib|poplib|xmlrpc|pycurl|paramiko|websockets?|XMLHttpRequest|WebSocket|axios|undici|node-fetch|EventSource|sendBeacon|dgram|Net::HTTP|open-uri|HTTParty|Faraday|LWP|IO::Socket|HTTP::Tiny|curl_exec|curl_init|fsockopen|stream_socket_client)\b|\b(?:from|import)\s+http\b|\bfetch\s*\(|\bhttps?\.(?:request|get)\s*\(|\bnet\.(?:connect|createConnection|Socket)\b|\btls\.connect\b|\b(?:Deno|Bun)\.connect\b|\/inet\/|\/dev\/(?:tcp|udp)\//;
const SPAWNS =
  /\b(?:subprocess|child_process|os\.(?:system|popen|exec\w*|spawn\w*|posix_spawn\w*)|pty\.spawn|execSync|spawnSync|execFileSync|execFile|spawn|popen|system|shell_exec|passthru|proc_open|Open3|qx|Deno\.Command|Bun\.spawn)\b/;
const NETWORK_PROGRAM = /\b(?:curl|wget|nc|ncat|netcat|ssh|scp|sftp|rsync|telnet)\b/;
const PYTHON_DYNAMIC =
  /\b(?:exec|eval|compile|__import__|importlib|getattr|globals|locals|vars|builtins|__builtins__)\b/;
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

function runnable(code: string, python: boolean): string {
  const logic = python ? pythonLogic(code) : null;
  return logic !== null && !PYTHON_DYNAMIC.test(logic) ? logic : code;
}

export function usesNetwork(code: string, python: boolean): boolean {
  const seen = runnable(code, python);
  if (NETWORK_CODE.test(seen)) return true;
  if (!SPAWNS.test(seen)) return false;
  return NETWORK_PROGRAM.test(code) || remoteHosts(codeHosts(code)).length > 0;
}
