export const SERVICENOW_ME = '6816f79cc0a8016401c5a33be04be441';
export const PRIYA = '46d44a23a9fe19810012d100cca80666';
export const SAM = '5137153cc611227c000bbd1bd8cd2005';
export const NETWORK_OPS = '287ebd7da9fe198100f92cc8d1d2154e';
export const SERVICE_DESK = 'd625dccec0a8016700a222a0f7900d06';

export interface FakeJournalEntry {
  element: 'work_notes' | 'comments';
  value: string;
  by: string;
  on: string;
}

export interface FakeRecord {
  sys_id: string;
  table: string;
  number: string;
  short_description: string;
  description: string;
  state: string;
  priority: string;
  impact: string;
  urgency: string;
  assignment_group: string;
  assigned_to: string;
  caller_id: string;
  sys_updated_on: string;
  sys_created_on: string;
  due_date: string;
  closed_at: string;
  journal: FakeJournalEntry[];
  attachments: { file_name: string; size_bytes: string }[];
}

export const USER_NAMES: Record<string, string> = {
  [SERVICENOW_ME]: 'Jordan Lee',
  [PRIYA]: 'Priya Nair',
  [SAM]: 'Sam Ortiz',
};

export const GROUP_NAMES: Record<string, string> = {
  [NETWORK_OPS]: 'Network Ops',
  [SERVICE_DESK]: 'Service Desk',
};

export const MEMBERSHIPS: [user: string, group: string][] = [[SERVICENOW_ME, NETWORK_OPS]];

export const CLOSE_CODES: [value: string, label: string][] = [
  ['Solved (Permanently)', 'Solved (Permanently)'],
  ['Solved (Work Around)', 'Solved (Work Around)'],
  ['Not Solved (Not Reproducible)', 'Not Solved (Not Reproducible)'],
];

export const CHOICES: Record<string, [value: string, label: string][]> = {
  incident: [
    ['1', 'New'],
    ['2', 'In Progress'],
    ['3', 'On Hold'],
    ['6', 'Resolved'],
    ['7', 'Closed'],
    ['8', 'Canceled'],
  ],
  sc_req_item: [
    ['-5', 'Pending'],
    ['1', 'Open'],
    ['2', 'Work in Progress'],
    ['3', 'Closed Complete'],
    ['4', 'Closed Incomplete'],
  ],
  sc_task: [
    ['-5', 'Pending'],
    ['1', 'Open'],
    ['2', 'Work in Progress'],
    ['3', 'Closed Complete'],
    ['7', 'Closed Skipped'],
  ],
  change_request: [
    ['-5', 'New'],
    ['-2', 'Scheduled'],
    ['-1', 'Implement'],
    ['0', 'Review'],
    ['3', 'Closed'],
    ['4', 'Canceled'],
  ],
  problem: [
    ['101', 'New'],
    ['102', 'Assess'],
    ['104', 'Fix in Progress'],
    ['106', 'Resolved'],
    ['107', 'Closed'],
  ],
};

export const PRIORITY_LABELS: Record<string, string> = {
  '1': '1 - Critical',
  '2': '2 - High',
  '3': '3 - Moderate',
  '4': '4 - Low',
  '5': '5 - Planning',
};

const FINAL_STATES: Record<string, readonly string[]> = {
  incident: ['6', '7', '8'],
  sc_req_item: ['3', '4'],
  sc_task: ['3', '7'],
  change_request: ['3', '4'],
  problem: ['106', '107'],
};

export function isActive(record: FakeRecord): boolean {
  return !(FINAL_STATES[record.table] ?? []).includes(record.state);
}

export function stamp(daysAgo: number): string {
  return new Date(Date.now() - daysAgo * 86_400_000).toISOString().slice(0, 19).replace('T', ' ');
}

function record(fields: Partial<FakeRecord> & Pick<FakeRecord, 'sys_id' | 'table' | 'number'>) {
  return {
    short_description: '',
    description: '',
    state: '1',
    priority: '3',
    impact: '2',
    urgency: '2',
    assignment_group: NETWORK_OPS,
    assigned_to: SERVICENOW_ME,
    caller_id: SAM,
    sys_updated_on: stamp(1),
    sys_created_on: stamp(5),
    due_date: '',
    closed_at: '',
    journal: [],
    attachments: [],
    ...fields,
  };
}

export function seedRecords(): FakeRecord[] {
  return [
    record({
      sys_id: '9d385017c611228701d22104cc95c371',
      table: 'incident',
      number: 'INC0010023',
      short_description: 'VPN drops every 20 minutes for remote staff',
      description:
        'Since Monday the GlobalProtect tunnel drops for remote staff about every 20 minutes. Reconnecting works.',
      state: '2',
      priority: '2',
      journal: [
        {
          element: 'work_notes',
          value: 'Reproduced on a test laptop.',
          by: 'jordan.lee',
          on: stamp(0.1),
        },
        {
          element: 'work_notes',
          value: 'Gateway idle timeout is 1200 s. Matches the drop interval.',
          by: 'priya.nair',
          on: stamp(0.03),
        },
        {
          element: 'comments',
          value: 'It dropped again at 10:20.',
          by: 'sam.ortiz',
          on: stamp(0.05),
        },
      ],
      attachments: [{ file_name: 'vpn-client.log', size_bytes: '24576' }],
    }),
    record({
      sys_id: '1c741bd70b2322007518478d83673af3',
      table: 'incident',
      number: 'INC0010031',
      short_description: 'Payroll export fails for EU entity',
      state: '1',
      priority: '1',
      sys_updated_on: stamp(0.2),
    }),
    record({
      sys_id: '57af7aec73d423002728660c4cf6a71c',
      table: 'incident',
      number: 'INC0010027',
      short_description: 'Shared drive mapping lost after macOS update',
      state: '3',
      priority: '3',
    }),
    record({
      sys_id: 'e8caedcbc0a80164017df472f39eaed1',
      table: 'incident',
      number: 'INC0010040',
      short_description: 'Wi-Fi on floor 2 asks for the password again',
      assignment_group: SERVICE_DESK,
      assigned_to: PRIYA,
    }),
    record({
      sys_id: 'aeed229047801200e0ef563dbb9a71c2',
      table: 'sc_task',
      number: 'SCTASK0010051',
      short_description: 'Image and ship laptop',
      state: '1',
      priority: '4',
      assigned_to: '',
    }),
    record({
      sys_id: 'c286d61347c12200e0ef563dbb9a7109',
      table: 'change_request',
      number: 'CHG0030012',
      short_description: 'Upgrade Postgres on billing-db',
      state: '-2',
      priority: '3',
    }),
    record({
      sys_id: 'd7296d02c0a801670085e737da016e70',
      table: 'problem',
      number: 'PRB0040007',
      short_description: 'Printers lose their queue after a reboot',
      state: '102',
      priority: '4',
    }),
  ];
}
