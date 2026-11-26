import '../conversations/chat-menu.css';
import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { MenuItem, MenuShell, type MenuAnchor } from '../conversations/MenuShell.tsx';
import { ToastHost } from '../conversations/Toast.tsx';
import { useToast } from '../conversations/use-toast.ts';
import { hostWords } from '../desktop/host-words.ts';
import { useRemoteClient } from '../phone/use-remote-client.ts';
import { GearIcon, PlusIcon } from '../ui/icons.tsx';
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
import { SparkIcon } from './SparkIcon.tsx';
import { SparkStatus } from './SparkStatus.tsx';

const POLL_MS = 5000;
const GAP = 8;

const BUTTON_ICON_SIZE = 24;
const MENU_ICON_SIZE = 20;

export function SparkSwitcher({ onManage }: { onManage: () => void }) {
  const queryClient = useQueryClient();
  const hidden = usePageHidden();
  const { remote, session } = useRemoteClient();
  const button = useRef<HTMLButtonElement>(null);
  const [anchor, setAnchor] = useState<MenuAnchor | null>(null);
  const toaster = useToast();
  const { show } = toaster;
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
    onError: (error: Error) => show({ text: error.message }),
  });
  const sparks = list.data?.sparks ?? [];
  if (!local || !list.data?.available || sparks.length === 0) return null;

  const own = list.data.local;
  const name = own.name ?? thisComputer(hostWords().computer);
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
        className="rail-btn rs-switch"
        aria-haspopup="menu"
        aria-expanded={anchor !== null}
        aria-label={switcherName(name, total)}
        title={own.name ?? undefined}
        onClick={() => (anchor ? closeMenu() : openMenu())}
      >
        <SparkIcon icon={own.icon} size={BUTTON_ICON_SIZE} name={own.name} />
        <span className="rs-switch-name">{thisComputer(hostWords().computer)}</span>
        {total > 0 && (
          <i className="rbadge" aria-hidden="true">
            {total}
          </i>
        )}
      </button>
      <ToastHost toaster={toaster} />
      {anchor && (
        <MenuShell
          anchor={anchor}
          label={SWITCHER_MENU}
          page="main"
          className="rs-switch-menu"
          onClose={closeMenu}
        >
          <MenuItem
            icon={<SparkIcon icon={own.icon} size={MENU_ICON_SIZE} name={own.name} />}
            label={name}
            checked
            onSelect={closeMenu}
          />
          {sparks.map((spark) => (
            <MenuItem
              key={spark.id}
              icon={<SparkIcon icon={spark.icon} size={MENU_ICON_SIZE} name={spark.name} />}
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
