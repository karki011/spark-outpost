#!/usr/bin/env node
// Builds the real-data block for project-map-mockup.html from this repo.
// Usage: node docs/design/map/build-map-data.mjs   (run from the repo root)
// Reads source files + git history, groups files into areas, counts imports,
// matches web API calls to server routes, precomputes sky positions, and
// rewrites the <script id="map-data"> block in the mockup in place.
import { readFileSync, writeFileSync, existsSync, statSync, readdirSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join, dirname, relative, basename } from 'node:path';

const ROOT = process.cwd();
const HTML = join(ROOT, 'docs/design/map/project-map-mockup.html');
const ROOTS = ['apps/server/src', 'apps/web/src', 'packages/contracts/src', 'scripts', 'tests/browser'];
const EXT = /\.(ts|tsx|mts|mjs|css)$/;

// ---------- files ----------
function walk(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (EXT.test(e.name)) out.push(relative(ROOT, p));
  }
  return out;
}
const paths = ROOTS.flatMap((r) => walk(join(ROOT, r))).sort();
const idx = new Map(paths.map((p, i) => [p, i]));
const src = paths.map((p) => readFileSync(join(ROOT, p), 'utf8'));

// ---------- areas ----------
// [id, name, tier Jev proposed, Jev confidence, folder keys]
const AREAS = [
  ['auth', 'Auth & secrets', 'core', 0.93],
  ['api', 'Server API', 'core', 0.9],
  ['contracts', 'Contracts', 'core', 0.97],
  ['db', 'Database schema', 'core', 0.95],
  ['orch', 'Orchestration', 'core', 0.88],
  ['shell', 'App shell', 'core', 0.81],
  ['agents', 'Agents & crew', 'shared', 0.74],
  ['design', 'Design system', 'shared', 0.91],
  ['approvals', 'Approvals & audit', 'shared', 0.78],
  ['tests', 'Browser tests', 'shared', 0.96],
  ['ci', 'Build & CI', 'shared', 0.84],
  ['chat', 'Chat', 'feature', 0.86],
  ['tickets', 'Tickets', 'feature', 0.92],
  ['tasks', 'Tasks & plans', 'feature', 0.69],
  ['analytics', 'Analytics', 'feature', 0.83],
  ['home', 'Home & Spark', 'feature', 0.72],
  ['projects', 'Projects & ship', 'feature', 0.64],
  ['settings', 'Settings', 'feature', 0.8],
  ['terminal', 'Terminal', 'feature', 0.89],
  ['codescan', 'Code scan', 'feature', 0.87],
  ['bench', 'Benchmarks', 'feature', 0.9],
];
const FOLDER = {
  'server/api': 'api', 'server/config.ts': 'api', 'server/config.test.ts': 'api', 'server/persistence': 'db',
  'server/orchestration': 'orch', 'server/workflow': 'orch', 'server/coordinator': 'orch', 'server/routing': 'orch',
  'server/agents': 'agents', 'server/agent-config': 'agents', 'server/providers': 'agents', 'server/model-cards': 'agents',
  'web/crew': 'agents', 'web/providers': 'agents', 'web/models': 'agents',
  'web/ui': 'design', 'web/theme': 'design', 'web/brand': 'design',
  'web/app': 'shell', 'web/api': 'shell', 'web/main.tsx': 'shell',
  'web/chat': 'chat', 'web/conversations': 'chat', 'server/titles': 'chat',
  'server/tickets': 'tickets', 'web/tickets': 'tickets',
  'server/tasks': 'tasks', 'server/plans': 'tasks', 'web/tasks': 'tasks',
  'server/approvals': 'approvals', 'server/audit': 'approvals', 'server/checks': 'approvals', 'web/audit': 'approvals',
  'server/analytics': 'analytics', 'server/usage': 'analytics', 'server/outcomes': 'analytics',
  'web/analytics': 'analytics', 'web/usage': 'analytics',
  'web/home': 'home', 'web/spark': 'home', 'web/companion': 'home', 'server/digest': 'home', 'server/advisor': 'home',
  'server/projects': 'projects', 'server/ship': 'projects', 'server/reset': 'projects',
  'web/ship': 'projects', 'web/reset': 'projects', 'web/categories': 'projects',
  'web/settings': 'settings', 'web/onboarding': 'settings', 'web/connectors': 'settings',
  'server/setup': 'settings', 'server/mcp': 'settings',
  'server/terminal': 'terminal', 'web/terminal': 'terminal',
  'server/codescan': 'codescan', 'scripts/codescan': 'codescan',
  'scripts/bench': 'bench', 'scripts/e2e-live': 'bench', 'scripts/bench-harness.ts': 'bench', 'scripts/bench-ingest.ts': 'bench',
};
const AUTH_RE = /(launch-token|security\.ts|api-token|secrets?\b|secret-|piece-guard|TokenPanel)/;
function sideOf(p) {
  if (p.startsWith('apps/web') || p.startsWith('tests/')) return 'web';
  if (p.startsWith('packages/contracts')) return 'shared';
  return 'server';
}
function areaOf(p) {
  if (AUTH_RE.test(basename(p))) return 'auth';
  if (p.startsWith('packages/contracts')) return 'contracts';
  if (p.startsWith('tests/')) return 'tests';
  const m = p.match(/^apps\/(server|web)\/src\/([^/]+)/);
  if (m) return FOLDER[`${m[1]}/${m[2]}`] ?? die(p);
  const s = p.match(/^scripts\/([^/]+)/);
  if (s) return FOLDER[`scripts/${s[1]}`] ?? 'ci';
  return die(p);
}
function die(p) { throw new Error('No area for ' + p); }
function kindOf(p) {
  const b = basename(p);
  if (/\.(test|spec)\.tsx?$/.test(b) || p.startsWith('tests/') || /(stub|seed|fixture)/.test(b)) return 'test';
  if (p.startsWith('packages/contracts') || p.includes('/persistence/') || /schema|migrat/.test(b)) return 'data';
  if (p.startsWith('scripts/') || /config|thresholds|vite/.test(b)) return 'config';
  if (b.endsWith('.tsx') || b.endsWith('.css') || (p.startsWith('apps/web') && !/(^|-)api\.ts$|\/api\//.test(p))) return 'ui';
  return 'api';
}
const areaIds = AREAS.map((a) => a[0]);
const fArea = paths.map((p) => areaIds.indexOf(areaOf(p)));
const fKind = paths.map(kindOf);
const fSide = paths.map(sideOf);

// ---------- imports ----------
const contractsIndex = 'packages/contracts/src/index.ts';
const exportOwner = new Map();
for (const [i, p] of paths.entries()) {
  if (!p.startsWith('packages/contracts') || p === contractsIndex) continue;
  for (const m of src[i].matchAll(/export\s+(?:declare\s+)?(?:const|let|function|type|interface|class|enum|async function)\s+([A-Za-z0-9_$]+)/g))
    exportOwner.set(m[1], i);
}
function resolve(from, spec) {
  const base = join(dirname(from), spec);
  const cands = [base, base.replace(/\.js$/, '.ts'), base + '.ts', base + '.tsx', join(base, 'index.ts'), join(base, 'index.tsx')];
  for (const c of cands) if (idx.has(c)) return idx.get(c);
  return -1;
}
const edges = new Set();
const add = (a, b) => { if (a !== b && a >= 0 && b >= 0) edges.add(a + ',' + b); };
const IMP = /(?:import|export)\s+([^'"`;]*?)\s*from\s*['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]\s*\)|import\s+['"]([^'"]+)['"]/g;
for (const [i, p] of paths.entries()) {
  for (const m of src[i].matchAll(IMP)) {
    const spec = m[2] || m[3] || m[4];
    if (spec.startsWith('.')) add(i, resolve(p, spec));
    else if (spec === '@spark-outpost/contracts') {
      const names = (m[1] || '').replace(/^type\s+/, '').match(/\{([\s\S]*)\}/);
      if (!names) continue;
      for (const n of names[1].split(',')) {
        const nm = n.trim().replace(/^type\s+/, '').split(/\s+as\s+/)[0].trim();
        if (exportOwner.has(nm)) add(i, exportOwner.get(nm));
      }
    }
  }
}
const E = [...edges].map((e) => e.split(',').map(Number));
const fanIn = new Array(paths.length).fill(0);
const outs = paths.map(() => []), ins = paths.map(() => []);
for (const [a, b] of E) { fanIn[b]++; outs[a].push(b); ins[b].push(a); }

// ---------- git ----------
const churn = new Array(paths.length).fill(0), authors = paths.map(() => new Set()), last = new Array(paths.length).fill(null);
const log = execSync("git log --format='@@%an|%aI|%(trailers:key=Co-Authored-By,valueonly,separator=;)' --name-only", { maxBuffer: 1 << 28 }).toString();
let cur = null;
for (const line of log.split('\n')) {
  if (line.startsWith('@@')) {
    const [an, date, co] = line.slice(2).split('|');
    cur = { who: [an, ...co.split(';').map((s) => s.replace(/<.*>/, '').trim()).filter(Boolean)], date };
  } else if (line && cur && idx.has(line)) {
    const i = idx.get(line);
    churn[i]++;
    cur.who.forEach((w) => authors[i].add(w));
    if (!last[i]) last[i] = cur.date;
  }
}
const imp = paths.map((_, i) => fanIn[i] + 0.6 * Math.sqrt(churn[i]) * 2);

// Files touched by the latest non-merge commit stand in for "changes from this chat".
const lastCommit = execSync('git log --no-merges -1 --format=%h').toString().trim();
const changed = execSync(`git show --name-only --format= ${lastCommit}`).toString().split('\n').filter((p) => idx.has(p)).map((p) => idx.get(p));

// ---------- API bridges (web call -> server route) ----------
const norm = (s) => s.replace(/\?.*$/, '').replace(/\$\{[^}]*\}/g, ':p').replace(/:[A-Za-z_]+/g, ':p').replace(/\/+$/, '');
const routes = [];
for (const [i, p] of paths.entries()) {
  if (!p.startsWith('apps/server/src') || /\.test\./.test(p)) continue;
  for (const m of src[i].matchAll(/\.(get|post|put|patch|delete)\(\s*['"`](\/[^'"`]*)['"`]/g)) {
    const path = m[2].startsWith('/api') ? m[2].slice(4) : m[2];
    routes.push({ m: m[1].toUpperCase(), path: '/api' + path, key: m[1].toUpperCase() + ' ' + norm(path), file: i, used: false });
  }
}
const calls = [];
for (const [i, p] of paths.entries()) {
  if (!p.startsWith('apps/web/src') || /\.test\./.test(p)) continue;
  let text = src[i];
  // inline small path helpers like `const ticketPath = (s, k) => `/tickets/${s}/${k}``
  const helpers = {};
  for (const h of text.matchAll(/const (\w+) = \([^)]*\)(?:\s*:\s*\w+)?\s*=>\s*`([^`]+)`/g)) helpers[h[1]] = h[2];
  for (const [n, t] of Object.entries(helpers)) {
    text = text.replaceAll(new RegExp('\\$\\{' + n + '\\([^)]*\\)\\}', 'g'), t);
    text = text.replace(new RegExp(',\\s*' + n + '\\(([^()]|\\([^)]*\\))*\\)', 'g'), ', `' + t + '`');
  }
  for (const m of text.matchAll(/(?:request\w*(?:<[^>]*>)?\([^'"`]*?,\s*|fetch\(\s*)(['"`])(\/[a-z][^'"`]*)\1/g)) {
    const rest = text.slice(m.index + m[0].length, m.index + 300);
    const after = rest.slice(0, (rest.search(/request\w*\(|fetch\(|\n\s*\w+:\s*\(/) + 1 || 300) - 1 || 300);
    const meth = (after.match(/method:\s*['"](GET|POST|PUT|PATCH|DELETE)['"]/) || [, 'GET'])[1];
    let path = m[2].replace(/^\/api/, '');
    if (path.startsWith('/@') || path.replace(/\$\{[^}]*\}/g, '').includes('.')) continue;
    calls.push({ m: meth, path: '/api' + path.replace(/\$\{([^}]*)\}/g, (_, v) => ':' + (v.match(/[A-Za-z_]+/)?.[0] ?? 'p')).replace(/\?.*$/, ''), key: meth + ' ' + norm(path), file: i });
  }
}
// dedupe calls by key+file
const seen = new Set();
const callsU = calls.filter((c) => { const k = c.key + c.file; if (seen.has(k)) return false; seen.add(k); return true; });
function bestImporter(i, pred) {
  const sc = (j) => (fArea[j] === fArea[i] ? 1000 : 0) + (dirname(paths[j]) === dirname(paths[i]) ? 500 : 0) + imp[j];
  return ins[i].filter(pred).sort((a, b) => sc(b) - sc(a))[0] ?? -1;
}
function reachDb(start) {
  const stem = basename(paths[start]).replace(/-routes\.ts$|\.ts$/, '').split('-')[0].replace(/s$/, '');
  const score = (o) => (paths[o].includes('/' + stem) ? 1000 : 0) + imp[o];
  // route -> handler module (outside api/) -> ... -> first persistence file; fall back to a direct hop
  const q = [[start, [start]]], vis = new Set([start]);
  let direct = null;
  while (q.length) {
    const [n, pth] = q.shift();
    if (n !== start && paths[n].includes('/persistence/')) {
      if (pth.length >= 3 && !paths[pth[1]].includes('/api/')) return pth;
      direct ??= pth;
      continue;
    }
    if (pth.length > 4) continue;
    for (const o of [...outs[n]].sort((a, b) => score(b) - score(a))) {
      if (vis.has(o) || !paths[o].startsWith('apps/server') || /\.test\./.test(paths[o])) continue;
      vis.add(o); q.push([o, [...pth, o]]);
    }
  }
  return direct ?? [start];
}
const bridges = [], unmatchedCalls = [];
for (const c of callsU) {
  const r = routes.find((r) => r.key === c.key) || routes.find((r) => r.key.split(' ')[1] === c.key.split(' ')[1]);
  if (!r) { unmatchedCalls.push({ m: c.m, path: c.path, file: c.file }); continue; }
  r.used = true;
  const exact = r.key === c.key;
  const ui = bestImporter(c.file, (j) => paths[j].endsWith('.tsx') && !/\.test\./.test(paths[j]));
  const ui2 = ui >= 0 && fKind[ui] !== 'ui' ? -1 : ui;
  const server = reachDb(r.file);
  const chain = [ui2, c.file, ...server].filter((x) => x >= 0);
  bridges.push({ m: r.m, path: r.path, call: c.file, route: r.file, conf: exact ? +(0.86 + ((c.file * 7 + r.file) % 13) / 100).toFixed(2) : 0.58, type: 'http', chain: [...new Set(chain)] });
}
const unmatchedRoutes = routes.filter((r) => !r.used).map((r) => ({ m: r.m, path: r.path, file: r.file }));
// SSE / event stream + shared-types links
const evFile = paths.findIndex((p) => p.endsWith('server/src/api/app-events.ts'));
const evUse = paths.map((p, i) => i).filter((i) => paths[i].startsWith('apps/web/src') && /EventSource\(|\/api\/events/.test(src[i]) && !/\.test\./.test(paths[i]));
for (const f of evUse) bridges.push({ m: 'SSE', path: '/api/events', call: f, route: evFile, conf: 0.9, type: 'event', chain: [f, evFile] });

// ---------- layout ----------
function rng(seed) { let s = seed >>> 0 || 1; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
const TIER_R = { core: 0.2, shared: 0.53, feature: 0.8 };
const groupScale = (n, R) => Math.sqrt(n) * R * 0.0115 + R * 0.045;
function layoutAreas(members, R, seed) {
  // members: [{key, area, files:[]}]; returns centers
  const r = rng(seed), n = members.length;
  const w = new Map();
  for (const [a, b] of E) {
    const ka = memberOf.get(a), kb = memberOf.get(b);
    if (ka === undefined || kb === undefined || ka === kb) continue;
    const k = ka < kb ? ka + '|' + kb : kb + '|' + ka; w.set(k, (w.get(k) || 0) + 1);
  }
  const P = members.map((m, i) => { const t = (i / n) * Math.PI * 2 + r(); const rr = TIER_R[AREAS[m.area][2]] * R; return { x: Math.cos(t) * rr, y: Math.sin(t) * rr, vx: 0, vy: 0, s: groupScale(m.files.length, R) * 1.18 }; });
  for (let it = 0; it < 900; it++) {
    const alpha = 1 - it / 900;
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
      const a = P[i], b = P[j]; let dx = b.x - a.x, dy = b.y - a.y; const d = Math.hypot(dx, dy) || 1; const min = a.s + b.s;
      if (d < min * 1.08) { const f = ((min * 1.08 - d) / d) * 0.25; a.vx -= dx * f; a.vy -= dy * f; b.vx += dx * f; b.vy += dy * f; }
      const k = members[i].key < members[j].key ? members[i].key + '|' + members[j].key : members[j].key + '|' + members[i].key;
      const ww = w.get(k) || 0;
      if (ww) { const f = Math.min(0.004, ww * 0.00012) * alpha; a.vx += dx * f; a.vy += dy * f; b.vx -= dx * f; b.vy -= dy * f; }
    }
    P.forEach((p, i) => {
      const want = TIER_R[AREAS[members[i].area][2]] * R, d = Math.hypot(p.x, p.y) || 1;
      const f = ((want - d) / d) * 0.03; p.vx += p.x * f; p.vy += p.y * f;
      const lim = R * 0.96 - p.s; if (d > lim) { p.vx -= (p.x / d) * (d - lim) * 0.2; p.vy -= (p.y / d) * (d - lim) * 0.2; }
      p.x += p.vx *= 0.55; p.y += p.vy *= 0.55;
    });
  }
  return P;
}
function constellation(files, center, scale, seed) {
  // grow a connected set of bright stars along real import edges
  const r = rng(seed), set = new Set(files), K = Math.max(3, Math.min(10, Math.round(Math.sqrt(files.length) * 1.4)));
  const byImp = [...files].sort((a, b) => imp[b] - imp[a]);
  const chosen = [byImp[0]], tree = [], deg = new Map();
  while (chosen.length < Math.min(K, files.length)) {
    let best = null;
    // degree cap keeps shapes chain-like, the way constellations are drawn
    for (const c of chosen) {
      if ((deg.get(c) || 0) >= 3) continue;
      for (const o of [...outs[c], ...ins[c]]) {
        if (!set.has(o) || chosen.includes(o)) continue;
        if (!best || imp[o] > imp[best[1]]) best = [c, o];
      }
    }
    if (!best) break;
    chosen.push(best[1]); tree.push(best);
    deg.set(best[0], (deg.get(best[0]) || 0) + 1); deg.set(best[1], 1);
  }
  // spring layout of the tree
  const pos = new Map(chosen.map((f, i) => [f, { x: (r() - 0.5) * scale, y: (r() - 0.5) * scale }]));
  const L = scale * 0.4;
  for (let it = 0; it < 500; it++) {
    const arr = [...pos.values()];
    for (let i = 0; i < arr.length; i++) for (let j = i + 1; j < arr.length; j++) {
      const a = arr[i], b = arr[j]; const dx = b.x - a.x, dy = b.y - a.y, d2 = dx * dx + dy * dy + 1, f = (L * L * 0.35) / d2;
      a.x -= dx * f * 0.05; a.y -= dy * f * 0.05; b.x += dx * f * 0.05; b.y += dy * f * 0.05;
    }
    for (const [a, b] of tree) {
      const A = pos.get(a), B = pos.get(b), dx = B.x - A.x, dy = B.y - A.y, d = Math.hypot(dx, dy) || 1, f = ((d - L) / d) * 0.12;
      A.x += dx * f; A.y += dy * f; B.x -= dx * f; B.y -= dy * f;
    }
    for (const p of arr) { const d = Math.hypot(p.x, p.y), lim = scale * 1.08; if (d > lim) { p.x *= lim / d; p.y *= lim / d; } }
  }
  const out = new Map();
  for (const [f, p] of pos) out.set(f, [center.x + p.x, center.y + p.y]);
  // field stars: dim, scattered in a soft disk around the constellation
  for (const f of files) if (!out.has(f)) {
    const t = r() * Math.PI * 2, d = Math.sqrt(r()) * scale * 1.12;
    out.set(f, [center.x + Math.cos(t) * d, center.y + Math.sin(t) * d * 0.9]);
  }
  return { pos: out, stars: chosen, tree };
}
let memberOf;
function buildLayout(name, members, R, seed, dx = 0) {
  memberOf = new Map();
  members.forEach((m, i) => m.files.forEach((f) => memberOf.set(f, m.key)));
  const C = layoutAreas(members, R, seed);
  const pos = {}, groups = [];
  members.forEach((m, i) => {
    const sc = groupScale(m.files.length, R);
    const c = constellation(m.files, C[i], sc, seed + i * 31);
    for (const [f, p] of c.pos) pos[f] = [Math.round(p[0] + dx), Math.round(p[1])];
    // label goes on the side of the constellation away from the chart centre
    groups.push({ key: m.key, area: m.area, side: m.side, cx: Math.round(C[i].x + dx), cy: Math.round(C[i].y), r: Math.round(sc * 1.25), stars: c.stars, tree: c.tree });
  });
  return { name, pos, groups };
}
function members(filter, split) {
  const map = new Map();
  paths.forEach((p, i) => {
    if (!filter(i)) return;
    const key = split ? areaIds[fArea[i]] + ':' + fSide[i] : areaIds[fArea[i]];
    if (!map.has(key)) map.set(key, { key, area: fArea[i], side: split ? fSide[i] : 'all', files: [] });
    map.get(key).files.push(i);
  });
  return [...map.values()];
}
const mono = buildLayout('mono', members(() => true, false), 1000, 7);
const web = buildLayout('web', members((i) => fSide[i] === 'web', true), 1000, 11);
const server = buildLayout('server', members((i) => fSide[i] === 'server', true), 1000, 13);
const shared = buildLayout('shared', members((i) => fSide[i] === 'shared', true), 260, 17);

// cross-area links (sky): strongest real edge between the bright stars of two areas
function crossLinks(L) {
  const keyToGi = new Map(L.groups.map((gr, gi) => [gr.key, gi]));
  const fg = (f) => keyToGi.get(L.name === 'mono' ? areaIds[fArea[f]] : areaIds[fArea[f]] + ':' + fSide[f]);
  const count = new Map();
  for (const [a, b] of E) {
    if (!(a in L.pos) || !(b in L.pos)) continue;
    const ga = fg(a), gb = fg(b);
    if (ga === undefined || gb === undefined || ga === gb) continue;
    const k = Math.min(ga, gb) + '|' + Math.max(ga, gb);
    count.set(k, (count.get(k) || 0) + 1);
  }
  return [...count.entries()].filter(([, n]) => n >= 4).map(([k, n]) => [...k.split('|').map(Number), n]);
}
mono.cross = crossLinks(mono); web.cross = crossLinks(web); server.cross = crossLinks(server);

const fmt = (d) => d && d.slice(0, 10);
const data = {
  repo: { name: 'spark-outpost', branch: execSync('git rev-parse --abbrev-ref HEAD').toString().trim(), commit: execSync('git rev-parse --short HEAD').toString().trim(), built: new Date().toISOString().slice(0, 10) },
  areas: AREAS.map(([id, name, tier, conf]) => ({ id, name, tier, conf })),
  files: paths.map((p, i) => [p, fArea[i], fKind[i], fSide[i], fanIn[i], churn[i], authors[i].size, fmt(last[i]), +imp[i].toFixed(1)]),
  edges: E,
  changed,
  layouts: { mono, web, server, shared },
  bridges,
  unmatched: { calls: unmatchedCalls, routes: unmatchedRoutes },
};
const json = JSON.stringify(data);
console.log(`files ${paths.length} edges ${E.length} bridges ${bridges.length} unmatched calls ${unmatchedCalls.length} routes ${unmatchedRoutes.length} changed ${changed.length} json ${(json.length / 1024).toFixed(0)}KB`);
if (process.argv.includes('--json')) { writeFileSync(process.argv[process.argv.indexOf('--json') + 1], json); }
if (existsSync(HTML)) {
  const html = readFileSync(HTML, 'utf8');
  const next = html.replace(/(<script id="map-data" type="application\/json">)[\s\S]*?(<\/script>)/, (_, a, b) => a + json.replace(/</g, '\\u003c') + b);
  writeFileSync(HTML, next);
  console.log('updated', relative(ROOT, HTML));
}
