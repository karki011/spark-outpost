import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  ARTIFACT_SHARE_PASSCODE_ALPHABET,
  ARTIFACT_SHARE_PASSCODE_LENGTH,
} from '@spark-outpost/contracts';
import { createApp } from '../src/api/app.ts';
import type { ShareService } from '../src/artifacts/share-service.ts';
import { shareSweeper, sweepShares } from '../src/artifacts/share-sweep.ts';
import { saveCloudflare } from '../src/cloudflare/store.ts';
import {
  CLOUDFLARE_UPLOAD_KEY_SECRET,
  memorySecretStore,
  type SecretStore,
} from '../src/setup/secrets.ts';
import { localClient, testAppOptions } from './app-support.ts';
import { ArtifactHarness } from './artifact-support.ts';
import { fakeShareService, type FakeShareService } from './fake-share-service.ts';
import { createTestDb, type TestDb } from './support.ts';

export const HTML = '<!doctype html><h1>Deploy failures</h1><script>draw()</script>';
export const PASSCODE = new RegExp(
  `^[${ARTIFACT_SHARE_PASSCODE_ALPHABET}]{${ARTIFACT_SHARE_PASSCODE_LENGTH}}$`,
);

export function untilAborted(init: RequestInit | undefined): Promise<Response> {
  return new Promise((_resolve, reject) => {
    const signal = init?.signal;
    if (!signal) return;
    if (signal.aborted) {
      reject(signal.reason);
      return;
    }
    signal.addEventListener('abort', () => reject(signal.reason), { once: true });
  });
}

export const UPLOAD_KEY = 'upk_0123456789abcdefghijklmnopqrstuv';

export interface FakeWorker {
  fake: FakeShareService;
  origin: string;
  close: () => Promise<void>;
}

export async function startFakeWorker(): Promise<FakeWorker> {
  const fake = fakeShareService();
  const server = createServer((req, res) => {
    void fake.handle(req, res).then((handled) => {
      if (!handled) res.writeHead(404).end();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    fake,
    origin: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

export class ShareHarness {
  readonly secrets: SecretStore = memorySecretStore();

  private constructor(
    readonly t: TestDb,
    readonly artifacts: ArtifactHarness,
    private readonly worker: FakeWorker,
  ) {}

  get fake(): FakeShareService {
    return this.worker.fake;
  }

  get origin(): string {
    return this.worker.origin;
  }

  static async create(): Promise<ShareHarness> {
    const t = await createTestDb();
    const artifacts = await ArtifactHarness.create(t);
    await artifacts.start('auto');
    return new ShareHarness(t, artifacts, await startFakeWorker());
  }

  async connectOwn(worker: FakeWorker = this.worker, maxDays = 7): Promise<void> {
    worker.fake.uploadKey = UPLOAD_KEY;
    await this.secrets.set(CLOUDFLARE_UPLOAD_KEY_SECRET, UPLOAD_KEY);
    await saveCloudflare(this.t.db, this.t.workspaceId, worker.origin, maxDays);
  }

  service(overrides: Partial<ShareService> = {}): ShareService {
    return { origin: this.origin, fetch, timeoutMs: 5_000, ...overrides };
  }

  app(service: ShareService | null = this.service()) {
    return createApp({
      ...testAppOptions(this.t, { secrets: this.secrets }),
      chatFolders: this.artifacts.base,
      shareService: service,
      sweepShares: shareSweeper({ db: this.t.db, secrets: this.secrets, service }),
    });
  }

  client(service: ShareService | null = this.service()) {
    return localClient(this.app(service));
  }

  sweep(service: ShareService | null = this.service()): Promise<void> {
    return sweepShares({ db: this.t.db, secrets: this.secrets, service });
  }

  async publish(kind: string, content: string, title = 'Deploy failures'): Promise<string> {
    const { facts } = await this.artifacts.call({ action: 'publish', title, kind, content });
    return facts.id as string;
  }

  async rows(table: string): Promise<string> {
    const { rows } = await this.t.db.query(`SELECT * FROM ${table}`);
    return JSON.stringify(rows);
  }

  async states(): Promise<string[]> {
    const { rows } = await this.t.db.query<{ state: string }>(
      'SELECT state FROM artifact_page_shares ORDER BY created_at',
    );
    return rows.map((row) => row.state);
  }

  async makePendingStale(): Promise<void> {
    await this.t.db.query(
      "UPDATE artifact_page_shares SET created_at = now() - interval '2 minutes' WHERE state = 'pending'",
    );
  }

  async close(): Promise<void> {
    await this.worker.close();
    await this.artifacts.close();
    await this.t.cleanup();
  }
}

export const sharePath = (id: string, version = 1) =>
  `/api/artifacts/${id}/versions/${version}/share`;
