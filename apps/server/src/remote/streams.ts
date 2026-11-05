import type { Response } from 'express';

export class DeviceStreams {
  private readonly open = new Map<string, Set<Response>>();

  track(deviceId: string, res: Response): void {
    const streams = this.open.get(deviceId) ?? new Set<Response>();
    this.open.set(deviceId, streams);
    streams.add(res);
    res.once('close', () => {
      streams.delete(res);
      if (streams.size === 0 && this.open.get(deviceId) === streams) this.open.delete(deviceId);
    });
  }

  connected(deviceId: string): boolean {
    return this.open.has(deviceId);
  }

  close(deviceId: string): void {
    for (const res of this.open.get(deviceId) ?? []) res.destroy();
  }

  closeAll(): void {
    for (const deviceId of [...this.open.keys()]) this.close(deviceId);
  }
}
