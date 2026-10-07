import json, sys
from datetime import datetime
def ts(s): return datetime.fromisoformat(s.replace('Z','+00:00')) if s else None
def hms(s): return s[11:23] if s else '-'
e = json.load(open(sys.argv[1]))
full = len(sys.argv) > 2
runs = e['runs']; byid = {r['id']: r for r in runs}
first = {f['id']: f for f in e['firstOutput']}
print('== chat', e['chat']['label'], e['chat']['provider'], e['chat']['mode'])
print('== runs')
tot = 0; tok = 0
for r in runs:
    f = first[r['id']]
    lat = ''
    if f['prompt_at'] and f['first_update_at']:
        lat = '%.1fs' % (ts(f['first_update_at']) - ts(f['prompt_at'])).total_seconds()
    boot = ''
    if r['started_at'] and f['prompt_at']:
        boot = '%.1fs' % (ts(f['prompt_at']) - ts(r['started_at'])).total_seconds()
    c = float(r['cost_usd'] or 0); tot += c; tok += int(r['total_tokens'] or 0)
    route = r['route'] or {}
    print(' %-11s %-22s %-10s %-11s mode=%-18s %s→%s dur=%s tools=%s $%.4f in=%s out=%s cr=%s cw=%s boot=%s first=%s%s' % (
        r['role'] or 'TURN', (r['agent_label'] or '')[:22], r['status'], r['model'], r['used_mode'] or r['agent_mode'],
        hms(r['started_at']), hms(r['finished_at']), r['duration_ms'], r['tool_call_count'], c,
        r['input_tokens'], r['output_tokens'], r['cached_read_tokens'], r['cached_write_tokens'], boot, lat,
        (' ERR ' + r['error'][:80]) if r['error'] else ''))
jev = sum(float(a['jev_cost_usd'] or 0) for a in e['advice'])
print(' total agent $%.4f jev $%.5f tokens %d' % (tot, jev, tok))
print('== approvals', len(e['approvals']))
for a in e['approvals']: print('  ', a['role'], a['kind'], a['title'][:70], a['status'], a['decided_by'], a['reason'])
print('== rail flags', len(e['railFlags']))
for f in e['railFlags']: print('  ', f['rail'], f['title'], f['paths'], f['status'], 'run', (byid.get(f['run_id']) or {}).get('agent_label'))
print('== session events')
for s in e['sessionEvents']:
    r = byid.get(s['run_id']) or {}
    print('  ', hms(s['at']), s['event'], s['agent_key'], '|', s['reason'], '| run', r.get('role'), r.get('agent_label'))
print('== plans')
for p in e['plans']: print('  v%s %s %s %s' % (p['version'], p['status'], p['approved_option'], json.dumps(p['body'])[:200 if not full else 3000]))
print('== pieces')
for p in e['pieces']:
    if 'error' in p: print(p); continue
    print('  ', p['key'], p['status'], 'owns', p['owns'], 'deps', p['depends_on'], 'model', p['model'], 'viol', json.dumps(p['violations'])[:300], '|', p.get('pick_note'))
print('== piece notes')
for n in e['pieceNotes']:
    if 'error' in n: print(n); continue
    print('  ', n['kind'], n['source'], 'delivered', n['delivered_at'], '|', n['body'][:300].replace('\n', ' '))
print('== advice')
for a in e['advice']:
    b = a['body']; r = byid.get(a['child_run_id']) or {}
    print('  ', hms(a['created_at']), a['purpose'], a['jev_status'], '|', (b.get('summary') or '')[:160], '| child', r.get('role'), r.get('agent_label'))
print('== member messages')
for m in e['memberMessages']: print('  ', hms(m['created_at']), m['urgency'], m['status'], 'delivered', (byid.get(m['delivered_run_id']) or {}).get('role'), (byid.get(m['delivered_run_id']) or {}).get('agent_label'), 'msg', m['message_id'], '|', m['body'][:70])
print('== messages')
for m in e['messages']: print('  ', hms(m['created_at']), m['role'], 'run', (byid.get(m['run_id']) or {}).get('role'), '|', m['content'][:(260 if not full else 3000)].replace('\n', ' ⏎ '))
print('== git')
for k, v in e['git'].items():
    if isinstance(v, dict):
        print('  ', k[-60:], 'branch', v['branch'], 'dirty' if v['status'].strip() else 'clean', 'tests', 'PASS' if v['test']['ok'] else 'FAIL')
        print('     ', v['log'].strip().replace('\n', ' | ')[:300])
print('== marks')
for m in e['marks']: print('  ', m['at'][11:23], m['what'][:120], json.dumps(m.get('data'))[:(200 if not full else 2000)] if 'data' in m else '')
