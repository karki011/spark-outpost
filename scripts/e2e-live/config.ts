import type { Version } from './plan.ts';

export const STUB_PORT = 4419;
export const STUB_URL = `http://127.0.0.1:${STUB_PORT}`;

export interface Ports {
  api: number;
  web: number;
}

export interface StackUrls {
  ports: Ports;
  api: string;
  web: string;
}

const PORTS: Record<Version, Ports> = {
  current: { api: 4339, web: 5194 },
  '2381803': { api: 4349, web: 5204 },
  '9a932f9': { api: 4359, web: 5214 },
  d87e633: { api: 4369, web: 5224 },
};

export function portsFor(version: Version): Ports {
  return PORTS[version];
}

export function urlsFor(ports: Ports): StackUrls {
  return {
    ports,
    api: `http://127.0.0.1:${ports.api}/api`,
    web: `http://127.0.0.1:${ports.web}`,
  };
}
