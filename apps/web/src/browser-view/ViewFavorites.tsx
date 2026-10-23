import { BROWSER_FAVORITES_MAX, parseBrowserUrl, sameFavoritePage } from '@spark-outpost/contracts';
import type { BrowserFavorite, BrowserPaneTab, BrowserProfile } from '@spark-outpost/contracts';
import { MinusIcon, PlusIcon } from '../ui/icons.tsx';
import { useTooltip } from '../ui/Tooltip.tsx';
import { initialOf } from './ViewTabs.tsx';
import { sendViewCommand } from './view-store.ts';

interface ViewFavoritesProps {
  profile: BrowserProfile;
  favorites: readonly BrowserFavorite[];
  tab: BrowserPaneTab | null;
}

function favoriteName(favorite: BrowserFavorite): string {
  return favorite.title.trim() || parseBrowserUrl(favorite.url)?.host || favorite.url;
}

function FavoriteTile({
  profile,
  favorite,
}: {
  profile: BrowserProfile;
  favorite: BrowserFavorite;
}) {
  const name = favoriteName(favorite);
  const tip = useTooltip(name, { side: 'bottom' });
  return (
    <li className="bv-fav">
      <button
        type="button"
        className="bv-fav-btn"
        aria-label={name}
        {...tip.triggerProps}
        onClick={() => sendViewCommand(profile, { command: 'open_favorite', id: favorite.id })}
        onKeyDown={(event) => {
          if (event.key !== 'Delete' && event.key !== 'Backspace') return;
          event.preventDefault();
          sendViewCommand(profile, { command: 'remove_favorite', id: favorite.id });
        }}
      >
        <span className="bv-tile" aria-hidden="true">
          {initialOf(name)}
        </span>
      </button>
      {tip.tooltip}
    </li>
  );
}

export function ViewFavorites({ profile, favorites, tab }: ViewFavoritesProps) {
  const page = tab !== null && tab.url !== '' && tab.error === null;
  const saved = page
    ? favorites.find((favorite) => sameFavoritePage(favorite.url, tab.url))
    : undefined;
  const full = favorites.length >= BROWSER_FAVORITES_MAX && !saved;
  const toggleLabel = saved ? 'Remove this page from Favorites' : 'Add this page to Favorites';
  const addTip = useTooltip(toggleLabel, { side: 'bottom' });
  const toggle = () => {
    if (saved) sendViewCommand(profile, { command: 'remove_favorite', id: saved.id });
    else if (tab) sendViewCommand(profile, { command: 'add_favorite', tabId: tab.id });
  };
  return (
    <section className="bv-section" aria-labelledby="bv-favorites">
      <h2 id="bv-favorites" className="bv-heading">
        Favorites
      </h2>
      <ul className="bv-favs" aria-label="Favorites">
        {favorites.map((favorite) => (
          <FavoriteTile key={favorite.id} profile={profile} favorite={favorite} />
        ))}
        {!full && (
          <li className="bv-fav">
            <button
              type="button"
              className="bv-fav-btn bv-fav-add"
              aria-label={toggleLabel}
              disabled={!page}
              {...addTip.triggerProps}
              onClick={toggle}
            >
              {saved ? <MinusIcon /> : <PlusIcon />}
            </button>
            {addTip.tooltip}
          </li>
        )}
      </ul>
    </section>
  );
}
