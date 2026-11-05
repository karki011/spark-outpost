import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { MacControlStatus, Profile } from '@spark-outpost/contracts';
import { desktopMacControl } from '../desktop/desktop-bridge.ts';
import { DocLink } from '../ui/DocLink.tsx';
import { CheckIcon } from '../ui/icons.tsx';
import { ProfileSwitchSetting } from './ProfileSwitchSetting.tsx';
import '../providers/providers.css';
import './full-disk-access.css';
import './mac-control.css';

export const MAC_CONTROL_LABEL = 'Let agents control other Mac apps';

const STATUS_KEY = ['mac-control', 'status'] as const;

const SWITCH_INFO = {
  lead: 'Agents read other Mac apps through the Accessibility tree and press their buttons and menus, one app per chat.',
  items: [
    {
      label: 'Always asks',
      text: 'The first use of an app in a chat, and any send, delete, submit or publish.',
    },
    {
      label: 'Never',
      text: 'Purchases, transfers, new accounts, System Settings, passwords, web browsers and Spark itself.',
    },
    {
      label: 'Leaves the Mac',
      text: 'What the agent reads in an app goes to the chat’s model provider.',
    },
  ],
};

function Permission({ status }: { status: MacControlStatus | undefined }) {
  if (!status) return null;
  if (status.trusted) {
    return (
      <span className="pill-ok">
        <CheckIcon />
        Allowed
      </span>
    );
  }
  return <span className="fda-pill">Not yet</span>;
}

function AccessibilityCard() {
  const mac = desktopMacControl();
  const queryClient = useQueryClient();
  const status = useQuery({
    queryKey: STATUS_KEY,
    queryFn: async () => (await mac?.status()) ?? null,
    refetchOnWindowFocus: 'always',
  });
  const current = status.data ?? undefined;
  const ask = async () => {
    const next = await mac?.prompt();
    if (next) queryClient.setQueryData(STATUS_KEY, next);
  };
  const missing = current?.helper === 'missing' || current?.helper === 'failed';
  return (
    <section className="pcard fda-card" aria-label="Accessibility">
      <div className="pc-head">
        <span className="nm">
          <b>Accessibility</b>
          <small>macOS permission for Spark Outpost</small>
        </span>
        <DocLink topic="Mac control" doc={{ page: 'mac-control', heading: 'turn-it-on' }} />
        {!missing && <Permission status={current} />}
      </div>
      <div className="pc-body">
        {missing ? (
          <p className="fda-note">
            This build has no Mac control helper. From source, run{' '}
            <code>pnpm desktop:mac-control</code>.
          </p>
        ) : current?.trusted ? (
          <p>Agents can read and press in other apps while the switch above is on.</p>
        ) : (
          <>
            <ol className="fda-steps">
              <li>
                Select <b>Ask macOS</b>, or open <b>Privacy &amp; Security → Accessibility</b>.
              </li>
              <li>
                Switch on <b>Spark Outpost</b>.
              </li>
              <li>Come back here. Spark checks again on its own.</li>
            </ol>
            <div className="mac-actions">
              <button type="button" className="btn primary sm" onClick={() => void ask()}>
                Ask macOS
              </button>
              <button type="button" className="btn sm" onClick={() => void mac?.openSettings()}>
                Open Accessibility settings
              </button>
            </div>
          </>
        )}
        <dl className="fda-facts">
          <div>
            <dt>Watch it</dt>
            <dd>A panel names the app the agent is controlling, with Stop.</dd>
          </div>
          <div>
            <dt>Take over</dt>
            <dd>Moving the mouse or typing in that app pauses the agent until you resume.</dd>
          </div>
          <div>
            <dt>Stop all</dt>
            <dd>
              <kbd>⌃⌥⌘.</kbd> stops Mac control at once.
            </dd>
          </div>
        </dl>
      </div>
    </section>
  );
}

export function MacControlSection({ profile }: { profile: Profile }) {
  return (
    <div className="mac-control">
      <ProfileSwitchSetting
        enabled={profile.macControl}
        label={MAC_CONTROL_LABEL}
        info={SWITCH_INFO}
        doc={{ page: 'mac-control', heading: 'turn-it-on' }}
        hint={(on) =>
          on
            ? 'New turns can read and press in one app per chat. What they read goes to the model provider.'
            : 'Off. Agents can’t see or use other apps.'
        }
        toUpdate={(value) => ({ macControl: value })}
      />
      <AccessibilityCard />
    </div>
  );
}
