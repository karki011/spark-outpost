import { z } from 'zod';

export const MAX_CHILDREN = 50;

export function projectOfKey(key: string, fallback: string | null): string | null {
  const dash = key.lastIndexOf('-');
  return dash > 0 ? key.slice(0, dash) : fallback;
}

export function lenientList<T extends z.ZodType>(item: T) {
  return z.unknown().transform((value): z.infer<T>[] => {
    if (!Array.isArray(value)) return [];
    return value.flatMap((entry) => {
      const parsed = item.safeParse(entry);
      return parsed.success ? [parsed.data as z.infer<T>] : [];
    });
  });
}

export function lenient<T extends z.ZodType>(item: T) {
  return z.unknown().transform((value): z.infer<T> | null => {
    const parsed = item.safeParse(value);
    return parsed.success ? (parsed.data as z.infer<T>) : null;
  });
}
