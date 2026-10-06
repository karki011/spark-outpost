import type { Response } from 'express';

export interface RemoteDevicePrincipal {
  id: string;
  name: string;
}

interface RemoteLocals {
  remote?: true;
  remoteDevice?: RemoteDevicePrincipal;
  remoteBlockedFields?: readonly string[];
}

function localsOf(res: Response): RemoteLocals {
  return res.locals as RemoteLocals;
}

export function markRemote(res: Response): void {
  localsOf(res).remote = true;
}

export function isRemote(res: Response): boolean {
  return localsOf(res).remote === true;
}

export function admitDevice(
  res: Response,
  device: RemoteDevicePrincipal,
  blockedFields: readonly string[],
): void {
  localsOf(res).remoteDevice = device;
  localsOf(res).remoteBlockedFields = blockedFields;
}

export function remoteDeviceOf(res: Response): RemoteDevicePrincipal | null {
  return localsOf(res).remoteDevice ?? null;
}

export function blockedFieldsOf(res: Response): readonly string[] {
  return localsOf(res).remoteBlockedFields ?? [];
}

export function presenceClientOf(res: Response, clientId: string | undefined): string {
  const device = remoteDeviceOf(res);
  return device ? `device:${device.id}` : `local:${clientId ?? 'window'}`;
}
