import { useEffect } from 'react';
import type { ConnectorId } from '../brand/ConnectorMark.tsx';
import { requestSettings } from '../settings/settings-request.ts';

let pending: ConnectorId | null = null;
const listeners = new Set<() => void>();

export function openConnectorCard(id: ConnectorId): void {
  pending = id;
  requestSettings('tools');
  listeners.forEach((listener) => listener());
}

export function takeConnectorCardRequest(): ConnectorId | null {
  const asked = pending;
  pending = null;
  return asked;
}

export function useConnectorCardRequests(open: (id: ConnectorId) => void): void {
  useEffect(() => {
    const take = () => {
      const asked = takeConnectorCardRequest();
      if (asked) open(asked);
    };
    listeners.add(take);
    return () => {
      listeners.delete(take);
    };
  }, [open]);
}
