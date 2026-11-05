import { useCallback, useState } from 'react';
import { z } from 'zod';
import type { Project } from '@spark-outpost/contracts';

const SAVED_KEY = 'spark-outpost.map-projects';

function readSaved(): string[] {
  try {
    const parsed = z
      .array(z.string())
      .safeParse(JSON.parse(localStorage.getItem(SAVED_KEY) ?? '[]'));
    return parsed.success ? parsed.data : [];
  } catch {
    return [];
  }
}

function save(ids: readonly string[]): void {
  try {
    localStorage.setItem(SAVED_KEY, JSON.stringify(ids));
  } catch {
    return;
  }
}

export function useMapSelection(projects: readonly Project[]) {
  const [saved, setSaved] = useState(readSaved);
  const known = saved.filter((id) => projects.some((project) => project.id === id));
  const selected = known.length > 0 ? known : projects.slice(0, 1).map((project) => project.id);
  const choose = useCallback((ids: string[]) => {
    setSaved(ids);
    save(ids);
  }, []);
  return { selected, choose };
}
