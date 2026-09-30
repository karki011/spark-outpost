import type { DatabaseSync } from 'node:sqlite';
import { getBudget, setBudget } from './budgets.ts';
import { addExpense, createProject, getProject, listProjects, projectTotal } from './projects.ts';

export interface Request {
  method: string;
  path: string;
  body?: unknown;
}

export interface Response {
  status: number;
  body: unknown;
}

const PROJECT = /^\/projects\/(\d+)(\/[a-z]+)?$/;

function field(body: unknown, name: string): unknown {
  return body && typeof body === 'object' ? (body as Record<string, unknown>)[name] : undefined;
}

export function handle(db: DatabaseSync, request: Request): Response {
  try {
    if (request.path === '/projects') {
      if (request.method === 'GET') return { status: 200, body: listProjects(db) };
      if (request.method === 'POST') {
        const project = createProject(db, String(field(request.body, 'name') ?? ''));
        return { status: 201, body: project };
      }
    }
    const match = PROJECT.exec(request.path);
    if (match) {
      const id = Number(match[1]);
      if (!getProject(db, id)) return { status: 404, body: { error: 'No such project.' } };
      const rest = match[2] ?? '';
      if (rest === '' && request.method === 'GET') return { status: 200, body: getProject(db, id) };
      if (rest === '/expenses' && request.method === 'POST') {
        const expense = addExpense(
          db,
          id,
          Number(field(request.body, 'amount')),
          String(field(request.body, 'note') ?? ''),
        );
        return { status: 201, body: expense };
      }
      if (rest === '/budget' && request.method === 'PUT') {
        const amount = field(request.body, 'amount');
        if (typeof amount !== 'number' || !Number.isInteger(amount) || amount <= 0) {
          return { status: 400, body: { error: 'amount must be a positive whole number.' } };
        }
        setBudget(db, id, amount);
      }
      if (rest === '/budget' && (request.method === 'GET' || request.method === 'PUT')) {
        return {
          status: 200,
          body: { projectId: id, amount: getBudget(db, id), spent: projectTotal(db, id) },
        };
      }
      if (rest === '/total' && request.method === 'GET') {
        return { status: 200, body: { total: projectTotal(db, id) } };
      }
    }
    return { status: 404, body: { error: 'Not found.' } };
  } catch (error) {
    return { status: 400, body: { error: error instanceof Error ? error.message : String(error) } };
  }
}
