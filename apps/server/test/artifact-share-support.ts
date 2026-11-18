import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  ARTIFACT_SHARE_PASSCODE_ALPHABET,
  ARTIFACT_SHARE_PASSCODE_LENGTH,
} from '@spark-outpost/contracts';
import { createApp } from '../src/api/app.ts';
import type { ShareService } from '../src/artifacts/share-service.ts';
import { shareSweeper, sweepShares } from '../src/artifacts/share-sweep.ts';
import { memorySecretStore, type SecretStore } from '../src/setup/secrets.ts';
import { localClient, testAppOptions } from './app-support.ts';
import { ArtifactHarness } from './artifact-support.ts';
import { fakeShareService, type FakeShareService } from './fake-share-service.ts';
import { createTestDb, type TestDb } from './support.ts';

export const HTML = '<!doctype html><h1>Deploy failures</h1><script>draw()</script>';
export const PASSCODE = new RegExp(
  `^[${ARTIFACT_SHARE_PASSCODE_ALPHABET}]{${ARTIFACT_SHARE_PASSCODE_LENGTH}}$`,
);

export class ShareHarness {
  readonly secrets: SecretStore = memorySecretStore();

  private constructor(
    readonly t: TestDb,
    readonly artifacts: ArtifactHarness,
    readonly fake: FakeShareService,
    private readonly server: Server,
    readonly origin: string,
  ) {}

  static async create(): Promise<ShareHarness> {
    const t = await createTestDb();
    const artifacts = await ArtifactHarness.create(t);
    await artifacts.start('auto');
    const fake = fakeShareService();
    const server = createServer((req, res) => {
      void fake.handle(req, res).then((handled) => {
        if (!handled) res.writeHead(404).end();
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as AddressInfo;
    return new ShareHarness(t, artifacts, fake, server, `http://127.0.0.1:${port}`);
  }

  service(overrides: Partial<ShareService> = {}): ShareService {
    return { origin: this.origin, fetch, timeoutMs: 5_000, ...overrides };
  }

  client(service: ShareService | null = this.service()) {
    const app = createApp({
      ...testAppOptions(this.t, { secrets: this.secrets }),
      chatFolders: this.artifacts.base,
      shareService: service,
      sweepShares: shareSweeper({ db: this.t.db, secrets: this.secrets, service }),
    });
    return localClient(app);
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

  async close(): Promise<void> {
    await new Promise<void>((resolve) => this.server.close(() => resolve()));
    await this.artifacts.close();
    await this.t.cleanup();
  }
}

export const sharePath = (id: string, version = 1) =>
  `/api/artifacts/${id}/versions/${version}/share`;
