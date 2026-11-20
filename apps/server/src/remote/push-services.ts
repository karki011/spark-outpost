import type { Db } from '../persistence/db.ts';
import type { SecretStore } from '../setup/secrets.ts';
import type { ClientFocus } from '../slack/client-focus.ts';
import { connectMacPresence } from './mac-presence.ts';
import { pushKeys, type PushKeys } from './push-keys.ts';
import { startPushNotifier, type PushNotifier } from './push-notifier.ts';
import { generateVapidKeys, webPushSend } from './push-send.ts';

export interface PushServicesDeps {
  db: Db;
  workspaceId: string;
  secrets: SecretStore;
  focus: Pick<ClientFocus, 'focusedClients'>;
  held: () => boolean;
}

export function startPushServices(deps: PushServicesDeps): {
  keys: PushKeys;
  notifier: PushNotifier;
} {
  const keys = pushKeys(deps.secrets, generateVapidKeys);
  const presence = connectMacPresence(process.env, process);
  const notifier = startPushNotifier({
    db: deps.db,
    workspaceId: deps.workspaceId,
    keys,
    focus: deps.focus,
    send: webPushSend,
    held: deps.held,
    present: () => presence?.present() ?? null,
  });
  presence?.onAway(() => notifier.release());
  return { keys, notifier };
}
