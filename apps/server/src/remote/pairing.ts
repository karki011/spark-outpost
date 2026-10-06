import { randomInt, randomUUID } from 'node:crypto';
import {
  PAIRING_CODE_LENGTH,
  PAIRING_TTL_MS,
  type PairingStart,
  type PendingPairing,
} from '@spark-outpost/contracts';
import { newSecret, secretHash } from './session.ts';

const CODE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
const CODE_GROUP = 4;
const START_LIMIT = 5;
const SUBMIT_LIMIT = 5;
const LIMIT_WINDOW_MS = 60_000;

export class PairingRateLimitError extends Error {
  constructor() {
    super('Too many pairing attempts. Wait a minute and try again.');
  }
}

interface Entry {
  id: string;
  state: 'open' | 'submitted' | 'confirmed';
  codeHash: string;
  claimHash: string | null;
  deviceName: string;
  matchCode: string;
  expiresAt: number;
}

export interface SubmittedPairing {
  id: string;
  claim: string;
  matchCode: string;
  expiresAt: string;
}

export type ClaimResult =
  { status: 'waiting' } | { status: 'confirmed'; id: string; deviceName: string } | null;

function newCode(): string {
  let code = '';
  for (let index = 0; index < PAIRING_CODE_LENGTH; index += 1) {
    code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  }
  return code;
}

function grouped(code: string): string {
  return code.match(new RegExp(`.{1,${CODE_GROUP}}`, 'g'))!.join('-');
}

function normalized(code: string): string {
  return code.toUpperCase().replace(/[^0-9A-Z]/g, '');
}

function newMatchCode(): string {
  const digits = String(randomInt(1_000_000)).padStart(6, '0');
  return `${digits.slice(0, 3)} ${digits.slice(3)}`;
}

class AttemptWindow {
  private attempts: number[] = [];

  constructor(
    private readonly limit: number,
    private readonly now: () => number,
  ) {}

  take(): void {
    const since = this.now() - LIMIT_WINDOW_MS;
    this.attempts = this.attempts.filter((at) => at > since);
    if (this.attempts.length >= this.limit) throw new PairingRateLimitError();
    this.attempts.push(this.now());
  }
}

export class Pairings {
  private readonly entries = new Map<string, Entry>();
  private readonly starts: AttemptWindow;
  private readonly submits: AttemptWindow;

  constructor(private readonly now: () => number = Date.now) {
    this.starts = new AttemptWindow(START_LIMIT, now);
    this.submits = new AttemptWindow(SUBMIT_LIMIT, now);
  }

  start(): PairingStart {
    this.starts.take();
    this.dropExpired();
    for (const entry of this.entries.values()) {
      if (entry.state === 'open') this.entries.delete(entry.id);
    }
    const code = newCode();
    const entry: Entry = {
      id: randomUUID(),
      state: 'open',
      codeHash: secretHash(code),
      claimHash: null,
      deviceName: '',
      matchCode: '',
      expiresAt: this.now() + PAIRING_TTL_MS,
    };
    this.entries.set(entry.id, entry);
    return { id: entry.id, code: grouped(code), expiresAt: this.isoExpiry(entry) };
  }

  submit(code: string, deviceName: string): SubmittedPairing | null {
    this.submits.take();
    this.dropExpired();
    const codeHash = secretHash(normalized(code));
    const entry = [...this.entries.values()].find(
      (candidate) => candidate.state === 'open' && candidate.codeHash === codeHash,
    );
    if (!entry) return null;
    const claim = newSecret();
    entry.state = 'submitted';
    entry.claimHash = secretHash(claim);
    entry.deviceName = deviceName;
    entry.matchCode = newMatchCode();
    entry.expiresAt = this.now() + PAIRING_TTL_MS;
    return {
      id: entry.id,
      claim,
      matchCode: entry.matchCode,
      expiresAt: this.isoExpiry(entry),
    };
  }

  pending(): PendingPairing[] {
    this.dropExpired();
    return [...this.entries.values()]
      .filter((entry) => entry.state === 'submitted')
      .map((entry) => this.view(entry));
  }

  confirm(id: string): PendingPairing | null {
    const entry = this.submitted(id);
    if (!entry) return null;
    entry.state = 'confirmed';
    entry.expiresAt = this.now() + PAIRING_TTL_MS;
    return this.view(entry);
  }

  deny(id: string): PendingPairing | null {
    const entry = this.submitted(id);
    if (!entry) return null;
    this.entries.delete(id);
    return this.view(entry);
  }

  claim(claim: string): ClaimResult {
    this.dropExpired();
    const claimHash = secretHash(claim);
    const entry = [...this.entries.values()].find((candidate) => candidate.claimHash === claimHash);
    if (!entry) return null;
    if (entry.state !== 'confirmed') return { status: 'waiting' };
    this.entries.delete(entry.id);
    return { status: 'confirmed', id: entry.id, deviceName: entry.deviceName };
  }

  private submitted(id: string): Entry | null {
    this.dropExpired();
    const entry = this.entries.get(id);
    return entry?.state === 'submitted' ? entry : null;
  }

  private view(entry: Entry): PendingPairing {
    return {
      id: entry.id,
      deviceName: entry.deviceName,
      matchCode: entry.matchCode,
      expiresAt: this.isoExpiry(entry),
    };
  }

  private isoExpiry(entry: Entry): string {
    return new Date(entry.expiresAt).toISOString();
  }

  private dropExpired(): void {
    const now = this.now();
    for (const entry of this.entries.values()) {
      if (entry.expiresAt <= now) this.entries.delete(entry.id);
    }
  }
}
