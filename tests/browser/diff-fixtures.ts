export const REWRITE_BEFORE = `import { readFile } from 'node:fs/promises';

interface Order {
  id: string;
  total: number;
  status: 'open' | 'paid' | 'void';
}

// Loads the orders and sums what is still owed.
export async function owed(path: string): Promise<number> {
  const raw = await readFile(path, 'utf8');
  const orders = JSON.parse(raw) as Order[];
  let sum = 0;
  for (let index = 0; index < orders.length; index++) {
    const order = orders[index];
    if (!order) continue;
    if (order.status === 'void') continue;
    if (order.status === 'paid') continue;
    if (typeof order.total !== 'number') {
      throw new Error('Order ' + order.id + ' has no total');
    }
    if (order.total < 0) {
      throw new Error('Order ' + order.id + ' is negative');
    }
    sum = sum + order.total;
  }
  const rounded = Math.round(sum * 100) / 100;
  if (Number.isNaN(rounded)) {
    return 0;
  }
  return rounded;
}

export const CURRENCY = 'USD';
`;

export const REWRITE_AFTER = `import { readFile } from 'node:fs/promises';

interface Order {
  id: string;
  total: number;
  status: 'open' | 'paid' | 'void';
}

// Loads the orders and sums what is still owed.
export async function owed(path: string): Promise<number> {
  const orders = await loadOrders(path);
  const open = orders.filter(isOpen);
  open.forEach(assertValidTotal);
  return toCents(open.reduce((sum, order) => sum + order.total, 0));
}

async function loadOrders(path: string): Promise<Order[]> {
  const parsed: unknown = JSON.parse(await readFile(path, 'utf8'));
  if (!Array.isArray(parsed)) {
    throw new TypeError(\`\${path} does not hold a list of orders\`);
  }
  return parsed.filter(isOrder);
}

function isOrder(value: unknown): value is Order {
  return typeof value === 'object' && value !== null && 'id' in value;
}

function isOpen(order: Order): boolean {
  return order.status === 'open';
}

function assertValidTotal(order: Order): void {
  if (!Number.isFinite(order.total) || order.total < 0) {
    throw new RangeError(\`Order \${order.id} has an invalid total\`);
  }
}

function toCents(amount: number): number {
  return Number.isFinite(amount) ? Math.round(amount * 100) / 100 : 0;
}

export const CURRENCY = 'USD';
`;

export const EDIT_BEFORE = `const RETRIES = 3;

export function label(count: number): string {
  // Plural only when there is more than one.
  const noun = count === 1 ? 'file' : 'files';
  return count + ' ' + noun + ' changed';
}

export function retry(task: () => void): void {
  for (let attempt = 0; attempt < RETRIES; attempt++) {
  task();
  }
}

export const done = true;
`;

export const EDIT_AFTER = `const RETRIES = 3;

export function label(count: number): string {
  // Plural only when there is more than one.
  const noun = count === 1 ? 'file' : 'files';
  return count + ' ' + noun + ' updated';
}

export function retry(task: () => void): void {
  for (let attempt = 0; attempt < RETRIES; attempt++) {
    task();
  }
}

export const done = true;
export const version = 2;
`;
