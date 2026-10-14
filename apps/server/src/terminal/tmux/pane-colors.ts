import type { TerminalColors } from '@spark-outpost/contracts';

const HEX_COLOR = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i;
const FOREGROUND = 10;
const BACKGROUND = 11;

function colorReport(code: number, color: string): string | null {
  const channels = HEX_COLOR.exec(color);
  if (!channels) return null;
  const [red, green, blue] = channels.slice(1).map((channel) => channel.toLowerCase().repeat(2));
  return `\\e]${code};rgb:${red}/${green}/${blue}\\e\\\\`;
}

export function colorReportCommands(paneId: string, colors: TerminalColors): string[] {
  return [colorReport(FOREGROUND, colors.foreground), colorReport(BACKGROUND, colors.background)]
    .filter((report) => report !== null)
    .map((report) => `refresh-client -r "${paneId}:${report}"`);
}
