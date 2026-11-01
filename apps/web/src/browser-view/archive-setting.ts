import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  DEFAULT_BROWSER_ARCHIVE,
  browserArchiveSettingSchema,
  type BrowserArchiveSetting,
} from '@spark-outpost/contracts';
import { desktopBrowserView } from '../desktop/desktop-bridge.ts';

const ARCHIVE_KEY = ['browser-archive-setting'] as const;

function parsed(raw: unknown): BrowserArchiveSetting {
  return browserArchiveSettingSchema.catch(DEFAULT_BROWSER_ARCHIVE).parse(raw);
}

export function useArchiveSetting(): BrowserArchiveSetting | null {
  const view = desktopBrowserView();
  const setting = useQuery({
    queryKey: ARCHIVE_KEY,
    queryFn: async () => parsed(await view?.archive()),
    enabled: view !== null,
  });
  return view ? (setting.data ?? DEFAULT_BROWSER_ARCHIVE) : null;
}

export function useSetArchiveSetting() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (setting: BrowserArchiveSetting) =>
      parsed(await desktopBrowserView()?.setArchive(setting)),
    onSuccess: (setting) => queryClient.setQueryData(ARCHIVE_KEY, setting),
  });
}
