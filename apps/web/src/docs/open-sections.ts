import { useEffect, useState } from 'react';

const KEY = 'spark-outpost.docs.open-sections';

function storedSections(): string[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    return Array.isArray(parsed) ? parsed.filter((item) => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

function storeSections(sections: readonly string[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(sections));
  } catch {
    return;
  }
}

export function useOpenSections(
  current: string,
  currentSection: string | undefined,
): { isOpen: (section: string) => boolean; toggle: (section: string) => void } {
  const [open, setOpen] = useState<readonly string[]>(storedSections);
  const [shown, setShown] = useState<string | null>(null);
  if (shown !== current) {
    setShown(current);
    if (currentSection && !open.includes(currentSection)) setOpen([...open, currentSection]);
  }
  useEffect(() => storeSections(open), [open]);
  return {
    isOpen: (section) => open.includes(section),
    toggle: (section) =>
      setOpen((sections) =>
        sections.includes(section)
          ? sections.filter((entry) => entry !== section)
          : [...sections, section],
      ),
  };
}
