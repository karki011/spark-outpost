import './watch-indicator.css';
import type { Profile, UpdateProfileRequest } from '@spark-outpost/contracts';
import { BlobToggle } from '../../brand/BlobToggle.tsx';
import { PHONE_SWITCH_OFF, useRemoteClient } from '../../phone/use-remote-client.ts';
import { useProfileSetting } from '../../settings/use-profile-setting.ts';
import { EyeIcon, EyeOffIcon } from '../../ui/icons.tsx';
import { useTooltip } from '../../ui/Tooltip.tsx';
import { indicatorTitle, type WatchIndicator } from './watch-indicator-model.ts';

function classes(base: string, indicator: WatchIndicator): string {
  return `${base} ${indicator.tone}${indicator.pulse ? ' pulse' : ''}`;
}

function Eye({ indicator }: { indicator: WatchIndicator }) {
  return (
    <span className="prw-eye" data-state={indicator.state}>
      {indicator.watching ? <EyeIcon /> : <EyeOffIcon />}
    </span>
  );
}

export function WatchMark({ indicator }: { indicator: WatchIndicator }) {
  const title = indicatorTitle(indicator);
  const { triggerProps, tooltip } = useTooltip(title, { side: 'top' });
  return (
    <span
      className={classes('prw-mark', indicator)}
      role="img"
      aria-label={title}
      {...triggerProps}
    >
      <Eye indicator={indicator} />
      {indicator.short && <span className="prw-short">{indicator.short}</span>}
      {tooltip}
    </span>
  );
}

interface OfferSwitchProps {
  label: string;
  saved: boolean;
  toUpdate: (value: boolean) => UpdateProfileRequest;
}

function OfferSwitch({ label, saved, toUpdate }: OfferSwitchProps) {
  const setting = useProfileSetting(saved, toUpdate);
  const allowed = useRemoteClient().allows('settings');
  return (
    <span className="prw-control">
      <BlobToggle
        size="sm"
        label={label}
        checked={setting.value}
        disabled={!allowed}
        onChange={setting.set}
      />
      <span aria-hidden="true">{label}</span>
      {!allowed && <span className="prw-locked">{PHONE_SWITCH_OFF}</span>}
      {setting.error && (
        <span className="prw-error" role="alert">
          {setting.error}
        </span>
      )}
    </span>
  );
}

const followUpUpdate = (value: boolean): UpdateProfileRequest => ({ prFollowUp: value });
const askUpdate = (value: boolean): UpdateProfileRequest => ({ prFollowUpAsk: value });

interface WatchDetailProps {
  indicator: WatchIndicator;
  profile: Profile | null;
}

export function WatchDetail({ indicator, profile }: WatchDetailProps) {
  return (
    <div className={classes('prw-detail', indicator)}>
      <p className="prw-head">
        <Eye indicator={indicator} />
        <span className="prw-label">{indicator.label}</span>
      </p>
      <p className="prw-lines">{indicator.lines.join(' ')}</p>
      {profile && indicator.offer === 'follow_up' && (
        <OfferSwitch
          label="Follow up on pull requests"
          saved={profile.prFollowUp}
          toUpdate={followUpUpdate}
        />
      )}
      {profile && indicator.offer === 'ask' && (
        <OfferSwitch
          label="Ask before pushing and replying"
          saved={profile.prFollowUpAsk}
          toUpdate={askUpdate}
        />
      )}
    </div>
  );
}
