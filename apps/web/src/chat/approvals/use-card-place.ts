import { remoteCardPlace, type Approval } from '@spark-outpost/contracts';
import { phoneApi } from '../../phone/phone-api.ts';
import { getAssertion } from '../../phone/passkey-browser.ts';
import { useRemoteClient } from '../../phone/use-remote-client.ts';

export const STEP_UP_CANCELLED = 'Your passkey was not used, so nothing was answered.';
export const STEP_UP_LINE = 'Answering here asks for your passkey first.';

export interface CardPlace {
  onMac: string | null;
  stepUp: boolean;
  confirm: () => Promise<void>;
}

async function confirmWithPasskey(approvalId: string): Promise<void> {
  const options = await phoneApi.stepUpOptions(approvalId);
  const assertion = await getAssertion(options).catch(() => null);
  if (!assertion) throw new Error(STEP_UP_CANCELLED);
  await phoneApi.stepUp(approvalId, assertion);
}

const ANSWER_HERE: CardPlace = { onMac: null, stepUp: false, confirm: async () => undefined };

export function useCardPlace(approval: Pick<Approval, 'id' | 'payload'>): CardPlace {
  const { remote, session } = useRemoteClient();
  if (!remote || !session) return ANSWER_HERE;
  const place = remoteCardPlace(approval.payload, {
    switches: session.switches,
    answering: session.cardAnswering,
    passkey: session.passkey,
  });
  if (place.place === 'mac') return { ...ANSWER_HERE, onMac: place.reason };
  if (place.place === 'here') return ANSWER_HERE;
  return { onMac: null, stepUp: true, confirm: () => confirmWithPasskey(approval.id) };
}
