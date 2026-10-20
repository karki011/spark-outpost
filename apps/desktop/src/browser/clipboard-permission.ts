export const CLIPBOARD_WRITE = 'clipboard-sanitized-write';
export const USER_GESTURE_MS = 5000;

export interface InputMarks {
  active: boolean;
  agentBusy: number;
  userInputAt: number | null;
  agentDoneAt: number | null;
}

export function userGestureCurrent(marks: InputMarks, now: number): boolean {
  if (!marks.active || marks.agentBusy > 0 || marks.userInputAt === null) return false;
  if (now - marks.userInputAt > USER_GESTURE_MS || marks.userInputAt > now) return false;
  return marks.agentDoneAt === null || marks.userInputAt > marks.agentDoneAt;
}

export function pagePermissionAllowed(
  permission: string,
  marks: InputMarks | null,
  now: number,
): boolean {
  if (permission !== CLIPBOARD_WRITE || marks === null) return false;
  return userGestureCurrent(marks, now);
}
