import { z } from 'zod';

const terminalColorSchema = z.string().regex(/^#[0-9a-f]{6}$/i);

export const terminalColorsSchema = z.strictObject({
  foreground: terminalColorSchema,
  background: terminalColorSchema,
});
export type TerminalColors = z.infer<typeof terminalColorsSchema>;
