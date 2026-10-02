import { useQuery } from '@tanstack/react-query';
import { setupApi, setupKey } from '../api/setup.ts';
import { ProfileSwitchSetting } from '../settings/ProfileSwitchSetting.tsx';

const HEARTBEAT_HINT =
  'Once a day Spark sends a random install ID, app version and OS. Cloudflare adds the country. No chats, code, names or IP addresses.';

const HEARTBEAT_INFO =
  'It tells the Spark Outpost team how many people use the app and where. While it is off, nothing is sent.';

export function HeartbeatSetting() {
  const setup = useQuery({ queryKey: setupKey, queryFn: setupApi.get });
  if (!setup.data) return null;
  return (
    <ProfileSwitchSetting
      enabled={setup.data.profile.heartbeat}
      label="Send anonymous heartbeat"
      info={HEARTBEAT_INFO}
      doc={{ page: 'privacy-and-secrets', heading: 'anonymous-heartbeat' }}
      hint={HEARTBEAT_HINT}
      toUpdate={(value) => ({ heartbeat: value })}
    />
  );
}
