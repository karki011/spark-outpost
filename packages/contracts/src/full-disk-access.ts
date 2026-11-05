import { z } from 'zod';

export const fullDiskAccessStatusSchema = z.enum([
  'granted',
  'not_granted',
  'unknown',
  'unsupported',
]);
export type FullDiskAccessStatusValue = z.infer<typeof fullDiskAccessStatusSchema>;

export const fullDiskAccessSchema = z.object({
  status: fullDiskAccessStatusSchema,
});
export type FullDiskAccessStatus = z.infer<typeof fullDiskAccessSchema>;

export const FULL_DISK_ACCESS_SYSTEM_SETTINGS_URL =
  'x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles';
