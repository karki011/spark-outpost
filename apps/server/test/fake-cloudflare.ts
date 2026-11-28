import { ARTIFACT_SHARE_SERVICE_NAME } from '@spark-outpost/contracts';
import { jsonResponse } from './app-support.ts';

export const FAKE_CLOUDFLARE_CLIENT = {
  clientId: 'a4d78d0dc7fff8786e067373dc0983fd',
  oauthUrl: 'https://dash.cloudflare.test/oauth2',
  apiUrl: 'https://api.cloudflare.test/client/v4',
  workerFile: '/nowhere/share-worker.mjs',
};

export const FAKE_ACCOUNT = 'acc0123456789';
export const FAKE_ORIGIN = 'https://spark-outpost-artifact-share.hazel.workers.dev';
export const FAKE_TUNNEL_TOKEN = 'tunnel-run-token-0123456789abcdef';
export const REACH_SCOPES_GRANTED =
  'account-settings.read zone.read dns.write argotunnel.write zone-access.write';
const ALL_SCOPES = 'account-settings.read workers-r2.write workers-scripts.admin';

const ok = (result: unknown) => jsonResponse(200, { success: true, errors: [], result });
const refused = (status: number, code: number, message: string) =>
  jsonResponse(status, { success: false, errors: [{ code, message }], result: null });

export class FakeCloudflare {
  scopes = ALL_SCOPES;
  r2Enabled = true;
  workersAllowed = true;
  subdomain: string | null = 'hazel';
  scriptExists = false;
  answersAfter = 0;
  loseUploadAnswer = false;
  onServiceAsked: (() => Promise<void>) | null = null;
  onTokenAsked: (() => Promise<void>) | null = null;
  readonly calls: string[] = [];
  readonly revoked: string[] = [];
  uploadedKey: string | null = null;
  uploadedModule: string | null = null;
  zones = [{ id: 'zone1', name: 'example.com' }];
  tunnelExists = false;
  dnsRecords: { type: string; content: string }[] = [];
  accessOn = true;
  accessApps: { domain: string }[] = [];
  readonly reach: { tunnelRoute: unknown; cname: unknown; policy: unknown } = {
    tunnelRoute: null,
    cname: null,
    policy: null,
  };
  private tokens = 0;
  private asked = 0;

  readonly fetch: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    const method = init?.method ?? 'GET';
    if (url.origin === FAKE_ORIGIN) {
      await this.onServiceAsked?.();
      return this.service(init);
    }
    if (url.pathname === '/oauth2/token') {
      await this.onTokenAsked?.();
      this.tokens += 1;
      return jsonResponse(200, {
        access_token: `token-${this.tokens}-0123456789`,
        expires_in: 3600,
        scope: this.scopes,
        token_type: 'bearer',
      });
    }
    if (url.pathname === '/oauth2/revoke') {
      this.revoked.push(String(new URLSearchParams(String(init?.body)).get('token')));
      return jsonResponse(200, {});
    }
    const path = url.pathname.replace('/client/v4', '');
    this.calls.push(`${method} ${path}`);
    const base = `/accounts/${FAKE_ACCOUNT}`;
    const script = `${base}/workers/scripts/spark-outpost-artifact-share`;
    if (path === '/accounts') return ok([{ id: FAKE_ACCOUNT, name: 'Hazel’s account' }]);
    const reached = await this.reachCall(method, path, init);
    if (reached) return reached;
    if (path === `${base}/r2/buckets`) {
      return this.r2Enabled
        ? ok({ name: 'spark-outpost-artifact-shares' })
        : refused(403, 10042, 'Please enable R2 through the Cloudflare Dashboard.');
    }
    if (path === `${base}/workers/subdomain`) {
      return this.subdomain
        ? ok({ subdomain: this.subdomain })
        : refused(404, 10007, 'There is not a subdomain registered.');
    }
    if (path === `${script}/settings`) {
      return this.scriptExists ? ok({}) : refused(404, 10007, 'This Worker does not exist.');
    }
    if (path === script && method === 'PUT') {
      if (!this.workersAllowed) return refused(403, 10000, 'No access to the specified resource.');
      const form = init?.body as FormData;
      const metadata = JSON.parse(await (form.get('metadata') as Blob).text()) as {
        main_module: string;
        bindings: { name: string; text?: string }[];
      };
      this.uploadedKey = metadata.bindings.find((b) => b.name === 'UPLOAD_KEY')?.text ?? null;
      this.uploadedModule = await (form.get(metadata.main_module) as Blob).text();
      this.scriptExists = true;
      if (this.loseUploadAnswer) {
        this.loseUploadAnswer = false;
        throw new Error('The answer was lost.');
      }
      return ok({ id: 'spark-outpost-artifact-share' });
    }
    if (path === `${script}/schedules` || path === `${script}/subdomain`) return ok({});
    return refused(404, 7003, 'No route for that URI');
  };

  private async reachCall(
    method: string,
    path: string,
    init: RequestInit | undefined,
  ): Promise<Response | null> {
    const tunnels = `/accounts/${FAKE_ACCOUNT}/cfd_tunnel`;
    const body = () => JSON.parse(String(init?.body)) as Record<string, unknown>;
    if (path === '/zones') return ok(this.zones);
    if (path === tunnels && method === 'GET') return ok(this.tunnelExists ? [{ id: 'tun1' }] : []);
    if (path === tunnels && method === 'POST') {
      this.tunnelExists = true;
      return ok({ id: 'tun1' });
    }
    if (path === `${tunnels}/tun1/configurations`) {
      this.reach.tunnelRoute = body().config;
      return ok({});
    }
    if (path === `${tunnels}/tun1/token`) return ok(FAKE_TUNNEL_TOKEN);
    if (path === '/zones/zone1/dns_records' && method === 'GET') return ok(this.dnsRecords);
    if (path === '/zones/zone1/dns_records' && method === 'POST') {
      this.reach.cname = body();
      return ok({ id: 'rec1' });
    }
    if (path === '/zones/zone1/access/apps' && method === 'GET') return ok(this.accessApps);
    if (path === '/zones/zone1/access/apps' && method === 'POST') {
      if (!this.accessOn) return refused(400, 12130, 'access.api.error.not_enabled');
      this.accessApps.push({ domain: String(body().domain) });
      return ok({ id: 'app1' });
    }
    if (path === '/zones/zone1/access/apps/app1/policies') {
      this.reach.policy = body();
      return ok({ id: 'pol1' });
    }
    return null;
  }

  private service(init: RequestInit | undefined): Response {
    this.asked += 1;
    if (this.asked <= this.answersAfter) return jsonResponse(404, {});
    const sent = new Headers(init?.headers).get('authorization');
    if (sent !== `Bearer ${this.uploadedKey}`) return jsonResponse(401, {});
    return jsonResponse(200, {
      service: ARTIFACT_SHARE_SERVICE_NAME,
      maxDays: 7,
      uploadKey: 'required',
    });
  }
}
