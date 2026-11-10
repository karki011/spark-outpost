const FRAMES = 10;

const rowsOf = () => [...document.querySelectorAll<HTMLElement>('.ib-main li[data-ticket]')];
const rowOf = (id: string) => rowsOf().find((row) => row.dataset.ticket === id);

function neighbourOf(ticketId: string): string | undefined {
  const rows = rowsOf();
  const index = rows.findIndex((row) => row.dataset.ticket === ticketId);
  return (rows[index + 1] ?? rows[index - 1])?.dataset.ticket;
}

export function keepListFocus(ticketId: string): void {
  const active = document.activeElement;
  const row = active?.closest<HTMLElement>('li[data-ticket]');
  const inDetail = active?.closest('.tk-detail') != null;
  if (!row && !inDetail) return;
  const target = row?.dataset.ticket === ticketId ? (neighbourOf(ticketId) ?? ticketId) : ticketId;
  const before = rowOf(target);
  const focusWhenSettled = (frames: number) => {
    const next = rowOf(target);
    if (next === before && next?.isConnected && frames > 0) {
      requestAnimationFrame(() => focusWhenSettled(frames - 1));
      return;
    }
    next?.querySelector<HTMLElement>('.ir-main')?.focus();
  };
  requestAnimationFrame(() => focusWhenSettled(FRAMES));
}
