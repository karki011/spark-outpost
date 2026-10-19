import { z } from 'zod';
import { BROWSER_URL_MAX } from './browser.ts';

export const BROWSER_EVAL_EXPRESSION_MAX = 4000;
export const BROWSER_EVAL_RESULT_MAX = 8000;
export const BROWSER_EVAL_TIMEOUT_MS = 10_000;
export const BROWSER_SELECTOR_MAX = 300;
export const BROWSER_STORAGE_ITEMS_MAX = 200;
export const BROWSER_STORAGE_VALUE_MAX = 500;

export const browserDevtoolsActionSchema = z.enum(['eval', 'inspect', 'performance', 'storage']);
export type BrowserDevtoolsAction = z.infer<typeof browserDevtoolsActionSchema>;

const boxSchema = z.object({
  x: z.number(),
  y: z.number(),
  width: z.number(),
  height: z.number(),
});

export const browserEvaluateShape = {
  type: z.string().max(40),
  value: z.string().max(BROWSER_EVAL_RESULT_MAX),
  exception: z.string().max(2000).nullable(),
  truncated: z.boolean(),
  masked: z.number().int().nonnegative(),
};

export const browserInspectShape = {
  matched: z.number().int().nonnegative(),
  element: z
    .object({
      tag: z.string().max(60),
      role: z.string().max(80),
      name: z.string().max(300),
      attributes: z.record(z.string().max(100), z.string().max(500)),
      styles: z.record(z.string().max(60), z.string().max(200)),
      box: boxSchema.nullable(),
      margin: boxSchema.nullable(),
      children: z.number().int().nonnegative(),
      masked: z.boolean(),
    })
    .nullable(),
};

const timingSchema = z.record(z.string().max(40), z.number());

export const browserPerformanceShape = {
  navigation: timingSchema.nullable(),
  resources: z.object({
    count: z.number().int().nonnegative(),
    byType: z.record(z.string().max(40), z.number().int().nonnegative()),
    slowest: z
      .array(
        z.object({
          url: z.string().max(BROWSER_URL_MAX),
          type: z.string().max(40),
          ms: z.number(),
          bytes: z.number().nullable(),
        }),
      )
      .max(10),
  }),
  vitals: z.object({
    lcpMs: z.number().nullable(),
    cls: z.number().nullable(),
    inpMs: z.number().nullable(),
    longTasks: z.number().int().nonnegative().nullable(),
    longTaskMs: z.number().nullable(),
    longestTaskMs: z.number().nullable(),
  }),
};

const storageItemSchema = z.object({
  key: z.string().max(300),
  bytes: z.number().int().nonnegative(),
  value: z.string().max(BROWSER_STORAGE_VALUE_MAX).optional(),
});

const cookieSchema = z.object({
  name: z.string().max(300),
  domain: z.string().max(300),
  path: z.string().max(500),
  secure: z.boolean(),
  httpOnly: z.boolean(),
  sameSite: z.string().max(20).nullable(),
  expires: z.string().max(40).nullable(),
  bytes: z.number().int().nonnegative(),
  value: z.string().max(BROWSER_STORAGE_VALUE_MAX).optional(),
});
export type BrowserCookieFacts = z.infer<typeof cookieSchema>;

export const browserStorageShape = {
  partition: z.enum(['agent', 'user']),
  valuesShown: z.boolean(),
  local: z.array(storageItemSchema).max(BROWSER_STORAGE_ITEMS_MAX),
  session: z.array(storageItemSchema).max(BROWSER_STORAGE_ITEMS_MAX),
  cookies: z.array(cookieSchema).max(BROWSER_STORAGE_ITEMS_MAX),
};
export type BrowserStorageItem = z.infer<typeof storageItemSchema>;
