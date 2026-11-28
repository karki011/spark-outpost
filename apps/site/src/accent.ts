interface SiteAccent {
  choose(accent: string): void;
  current(): string;
  darkSkin(): string;
}

declare global {
  interface Window {
    sparkAccent?: SiteAccent;
  }
}

function labelOf(input: HTMLInputElement): string {
  return input.closest('label')?.textContent?.trim() ?? '';
}

export function setUpAccentPicker(): void {
  const picker = document.querySelector<HTMLElement>('[data-accent-picker]');
  const name = picker?.querySelector<HTMLElement>('[data-accent-name]');
  const accent = window.sparkAccent;
  if (!picker || !name || !accent) return;
  const inputs = [...picker.querySelectorAll<HTMLInputElement>('input[name="accent"]')];

  const sync = () => {
    const current = accent.current();
    for (const dark of document.querySelectorAll<HTMLElement>('[data-dark-skin]')) {
      dark.dataset.skin = accent.darkSkin();
    }
    for (const input of inputs) {
      input.checked = input.value === current;
      if (input.checked) name.textContent = labelOf(input);
    }
  };

  picker.addEventListener('change', (event) => {
    const input = event.target as HTMLInputElement;
    accent.choose(input.value);
    sync();
    picker.dispatchEvent(new CustomEvent('spark-accent', { bubbles: true }));
  });
  sync();
}
