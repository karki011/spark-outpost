import '../conversations/chat-menu.css';
import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { MenuItem, MenuShell, type MenuAnchor } from '../conversations/MenuShell.tsx';
import { hostWords } from '../desktop/host-words.ts';
import { useRemoteClient } from '../phone/use-remote-client.ts';
import { GearIcon, LaptopIcon, PlusIcon } from '../ui/icons.tsx';
import { usePageHidden } from '../ui/use-page-hidden.ts';
import { requestAddSpark } from './add-spark-request.ts';
import { remoteSparkKeys, remoteSparksApi } from './remote-sparks-api.ts';
import {
  ADD_SPARK_ITEM,
  MANAGE_SPARKS_ITEM,
  SWITCHER_MENU,
  switcherName,
  thisComputer,
  waitingTotal,
} from './remote-sparks-copy.ts';
import { SparkStatus } from './SparkStatus.tsx';

const POLL_MS = 5000;
const GAP = 8;

const SWITCH_ICON = (
  <svg
    width={20}
    height={20}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.8}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M5 6h14v10H5zM3 19h18" />
  </svg>
);

export function SparkSwitcher({ onManage }: { onManage: () => void }) {
  const queryClient = useQueryClient();
  const hidden = usePageHidden();
  const { remote, session } = useRemoteClient();
  const button = useRef<HTMLButtonElement>(null);
  const [anchor, setAnchor] = useState<MenuAnchor | null>(null);
  const local = session !== undefined && !remote;
  const list = useQuery({
    queryKey: remoteSparkKeys.all,
    queryFn: remoteSparksApi.list,
    refetchInterval: hidden ? false : POLL_MS,
    enabled: local,
  });
  const open = useMutation({
    mutationFn: (id: string) => remoteSparksApi.open(id),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: remoteSparkKeys.all }),
  });
  const sparks = list.data?.sparks ?? [];
  if (!local || !list.data?.available || sparks.length === 0) return null;

  const computer = hostWords().computer;
  const total = waitingTotal(sparks);
  const closeMenu = () => {
    setAnchor(null);
    button.current?.focus();
  };
  const openMenu = () => {
    const rect = button.current?.getBoundingClientRect();
    if (!rect) return;
    setAnchor({
      x: rect.right + GAP,
      y: rect.top,
      above: rect.bottom,
      focusBack: button.current,
    });
  };
  return (
    <>
      <button
        ref={button}
        type="button"
        className={anchor ? 'rail-btn on' : 'rail-btn'}
        aria-haspopup="menu"
        aria-expanded={anchor !== null}
        aria-label={switcherName(computer, total)}
        onClick={() => (anchor ? closeMenu() : openMenu())}
      >
        {SWITCH_ICON}
        {thisComputer(computer)}
        {total > 0 && (
          <i className="rbadge" aria-hidden="true">
            {total}
          </i>
        )}
      </button>
      {open.error && (
        <span className="sr-only" role="alert">
          {open.error.message}
        </span>
      )}
      {anchor && (
        <MenuShell
          anchor={anchor}
          label={SWITCHER_MENU}
          page="main"
          className="rs-switch-menu"
          onClose={closeMenu}
        >
          <MenuItem
            icon={<LaptopIcon />}
            label={thisComputer(computer)}
            checked
            onSelect={closeMenu}
          />
          {sparks.map((spark) => (
            <MenuItem
              key={spark.id}
              icon={<LaptopIcon />}
              label={spark.name}
              trailing={<SparkStatus spark={spark} />}
              onSelect={() => {
                closeMenu();
                open.mutate(spark.id);
              }}
            />
          ))}
          <hr />
          <MenuItem
            icon={<PlusIcon />}
            label={ADD_SPARK_ITEM}
            onSelect={() => {
              closeMenu();
              requestAddSpark();
              onManage();
            }}
          />
          <MenuItem
            icon={<GearIcon />}
            label={MANAGE_SPARKS_ITEM}
            onSelect={() => {
              closeMenu();
              onManage();
            }}
          />
        </MenuShell>
      )}
    </>
  );
}
