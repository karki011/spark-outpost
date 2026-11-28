import { cloudflareReachSchema, type CloudflareReach } from '@spark-outpost/contracts';
import type { TunnelRunner, TunnelState } from '../src/cloudflare/tunnel-runner.ts';
import type { localClient } from './app-support.ts';

export const REACH = '/api/cloudflare/reach';
export const WANTED = { hostname: 'spark.example.com', email: 'owner@example.com' };

export class FakeRunner implements TunnelRunner {
  connects = true;
  current: TunnelState = 'off';
  readonly started: string[] = [];
  state = () => this.current;
  serving = () => (this.current === 'off' ? null : (this.started.at(-1) ?? null));
  start(token: string) {
    this.started.push(token);
    this.current = this.connects ? 'running' : 'stopped';
    return Promise.resolve(this.connects);
  }
  stop() {
    this.current = 'off';
  }
}

export type Client = ReturnType<typeof localClient>;

export async function settled(client: Client): Promise<CloudflareReach> {
  for (let tries = 0; tries < 200; tries += 1) {
    const reach = cloudflareReachSchema.parse((await client.get(REACH).expect(200)).body);
    if (reach.status !== 'working' && reach.status !== 'waiting') return reach;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('The set-up never settled.');
}

export async function comeBack(started: CloudflareReach) {
  const authorize = new URL(started.authorizeUrl!);
  const back = new URL(authorize.searchParams.get('redirect_uri')!);
  back.searchParams.set('code', 'code-from-cloudflare');
  back.searchParams.set('state', authorize.searchParams.get('state')!);
  await fetch(back);
  return authorize;
}

export async function setUp(client: Client) {
  const started = cloudflareReachSchema.parse(
    (await client.send('post', REACH, WANTED).expect(200)).body,
  );
  const authorize = await comeBack(started);
  return { authorize, reach: await settled(client) };
}

export const failed = (reach: CloudflareReach) =>
  reach.steps.find((step) => step.state === 'failed');

export const states = (reach: CloudflareReach) =>
  Object.fromEntries(reach.steps.map((step) => [step.id, step.state]));
