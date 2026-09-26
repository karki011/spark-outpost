import { useEffect } from 'react';

const BASE_TITLE = 'Spark Outpost';
const ICON = '/favicon.svg';
const WAITING_ICON = '/favicon-waiting.svg';

function setIcon(href: string) {
  const link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
  if (link && link.getAttribute('href') !== href) link.setAttribute('href', href);
}

export function useAttentionTitle(waiting: number) {
  useEffect(() => {
    document.title = waiting > 0 ? `(${waiting}) ${BASE_TITLE}` : BASE_TITLE;
    setIcon(waiting > 0 ? WAITING_ICON : ICON);
  }, [waiting]);

  useEffect(
    () => () => {
      document.title = BASE_TITLE;
      setIcon(ICON);
    },
    [],
  );
}
