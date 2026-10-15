import type { PushSubscribeRequest } from '@spark-outpost/contracts';
import { base64UrlOf, bytesOf } from './passkey-browser.ts';

export type PushSupport = 'supported' | 'needs_home_screen' | 'unsupported';

export interface LocalPush {
  registration: ServiceWorkerRegistration;
  subscription: PushSubscription | null;
}

const WORKER_URL = '/sw.js';

function appleTouchDevice(): boolean {
  const agent = navigator.userAgent;
  return (
    /iPhone|iPad|iPod/.test(agent) || (/Macintosh/.test(agent) && navigator.maxTouchPoints > 1)
  );
}

function installedApp(): boolean {
  const standalone = (navigator as Navigator & { standalone?: boolean }).standalone === true;
  return standalone || window.matchMedia('(display-mode: standalone)').matches;
}

export function pushSupport(): PushSupport {
  const supported =
    'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  if (supported) return 'supported';
  return appleTouchDevice() && !installedApp() ? 'needs_home_screen' : 'unsupported';
}

export function notificationsBlocked(): boolean {
  return 'Notification' in window && Notification.permission === 'denied';
}

export function registerServiceWorker(): Promise<ServiceWorkerRegistration> {
  return navigator.serviceWorker.register(WORKER_URL);
}

export async function localPush(): Promise<LocalPush> {
  await registerServiceWorker();
  const registration = await navigator.serviceWorker.ready;
  return { registration, subscription: await registration.pushManager.getSubscription() };
}

function keyOf(subscription: PushSubscription): string | null {
  const key = subscription.options.applicationServerKey;
  return key ? base64UrlOf(key) : null;
}

export function subscribedWith(subscription: PushSubscription, publicKey: string): boolean {
  const key = keyOf(subscription);
  return key === null || key === publicKey.replace(/=+$/, '');
}

export function subscribe(
  registration: ServiceWorkerRegistration,
  publicKey: string,
): Promise<PushSubscription> {
  return registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: bytesOf(publicKey),
  });
}

export function subscribeRequest(subscription: PushSubscription): PushSubscribeRequest {
  const keys = subscription.toJSON().keys ?? {};
  return {
    endpoint: subscription.endpoint,
    keys: { p256dh: keys.p256dh ?? '', auth: keys.auth ?? '' },
  };
}
