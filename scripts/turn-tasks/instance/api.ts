import { API_TOKEN_HEADER, type Approval } from '../../../packages/contracts/src/index.ts';

const ENDED = ['succeeded', 'failed', 'cancelled'];

export class Api {
  constructor(
    readonly base: string,
    private readonly token: string,
  ) {}

  async call<T>(method: string, path: string, body?: unknown): Promise<T> {
    const response = await fetch(`${this.base}${path}`, {
      method,
      headers: {
        [API_TOKEN_HEADER]: this.token,
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (!response.ok) {
      throw new Error(`${method} ${path} answered ${response.status}: ${await response.text()}`);
    }
    return (await response.json()) as T;
  }

  async healthy(): Promise<boolean> {
    const response = await fetch(`${this.base}/health`, {
      headers: { [API_TOKEN_HEADER]: this.token },
    });
    return response.ok;
  }

  async pending(conversationId: string): Promise<Approval[]> {
    const detail = await this.call<{ approvals?: Approval[] }>(
      'GET',
      `/conversations/${conversationId}`,
    );
    return (detail.approvals ?? []).filter((approval) => approval.status === 'pending');
  }

  async finished(runId: string): Promise<boolean> {
    const run = await this.call<{ finishedAt?: string | null; status: string }>(
      'GET',
      `/runs/${runId}`,
    );
    return Boolean(run.finishedAt) || ENDED.includes(run.status);
  }

  async cancel(runId: string): Promise<void> {
    await this.call('POST', `/runs/${runId}/cancel`, {});
  }
}
