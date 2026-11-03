import './link-cards.css';
import { useMemo } from 'react';
import { GlobeIcon } from '../../ui/icons.tsx';
import { linkAddresses } from './link-urls.ts';

const SHOWN_CARDS = 3;

export function LinkCards({ text }: { text: string }) {
  const addresses = useMemo(() => linkAddresses(text), [text]);
  if (addresses.length === 0) return null;
  const shown = addresses.slice(0, SHOWN_CARDS);
  const more = addresses.length - shown.length;
  return (
    <div className="link-cards" role="group" aria-label="Links">
      {shown.map((address) => (
        <a
          key={address.href}
          className="link-card"
          href={address.href}
          target="_blank"
          rel="noopener noreferrer"
          title={address.href}
        >
          <GlobeIcon />
          <span className="link-card-text">
            <b className="link-card-host">{address.host}</b>
            {address.path && <span className="link-card-path">{address.path}</span>}
          </span>
        </a>
      ))}
      {more > 0 && <span className="link-cards-more">+{more} more</span>}
    </div>
  );
}
