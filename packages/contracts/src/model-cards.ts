import { z } from 'zod';
import { providerIdSchema } from './setup.ts';

export const MODEL_TIERS = ['small', 'mid', 'top', 'frontier'] as const;
export const modelTierSchema = z.enum(MODEL_TIERS);
export type ModelTier = z.infer<typeof modelTierSchema>;

export const CARD_CATEGORIES = [
  'question',
  'fix',
  'feature',
  'refactor',
  'review',
  'plan',
  'destructive',
] as const;
export const cardCategorySchema = z.enum(CARD_CATEGORIES);
export type CardCategory = z.infer<typeof cardCategorySchema>;

export const JEV_CARD_CHARACTERS = 160;

const isoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const cardSourceSchema = z.object({
  url: z.string().min(1),
  checkedAt: isoDateSchema,
});
export type CardSource = z.infer<typeof cardSourceSchema>;

export const cardPriceSchema = z.object({
  inputPerMillion: z.number().nonnegative(),
  cachedInputPerMillion: z.number().nonnegative(),
  cacheWritePerMillion: z.number().nonnegative().nullable(),
  outputPerMillion: z.number().nonnegative(),
  note: z.string(),
});
export type CardPrice = z.infer<typeof cardPriceSchema>;

export const modelSpeedSchema = z.enum(['fastest', 'fast', 'moderate', 'slower']);
export type ModelSpeed = z.infer<typeof modelSpeedSchema>;

export const modelCardSchema = z.object({
  provider: providerIdSchema,
  id: z.string().min(1),
  label: z.string().min(1),
  match: z.object({ ids: z.array(z.string().min(1)), labels: z.array(z.string().min(1)) }),
  tier: modelTierSchema,
  price: cardPriceSchema.nullable(),
  contextTokens: z.number().int().positive(),
  maxOutputTokens: z.number().int().positive(),
  speed: modelSpeedSchema,
  reasoning: z.object({
    mode: z.string().min(1),
    efforts: z.array(z.string()),
    defaultEffort: z.string().nullable(),
    note: z.string(),
    effortKeepsCache: z.boolean().optional(),
  }),
  strengths: z.array(z.string()).max(4),
  weakSpots: z.array(z.string()).max(4),
  blurb: z.string().min(1).max(60),
  knowledgeCutoff: z.string(),
  retiresNotBefore: isoDateSchema.nullable(),
  retired: z.boolean().optional(),
  sources: z.array(cardSourceSchema).min(1),
});
export type ModelCard = z.infer<typeof modelCardSchema>;

export const providerCardSchema = z.object({
  provider: providerIdSchema,
  label: z.string().min(1),
  adapter: z.string().min(1),
  doMode: z.enum(['yes', 'no']),
  asksBeforeCommands: z.enum(['every', 'outside-sandbox-only', 'never']),
  sandbox: z.string(),
  resume: z.enum(['yes', 'no']),
  review: z.enum(['yes', 'no']),
  coldStartSeconds: z.tuple([z.number(), z.number()]),
  costSource: z.enum(['reported', 'estimated']),
  everydayModel: z.string().nullable(),
  strengths: z.array(z.string()),
  limits: z.array(z.string()),
  jevNote: z.string().min(1).max(40),
  sources: z.array(cardSourceSchema).min(1),
});
export type ProviderCard = z.infer<typeof providerCardSchema>;

export const vendorCardsFileSchema = z.object({
  schemaVersion: z.literal(1),
  checkedAt: isoDateSchema,
  providers: z.array(providerCardSchema),
  cards: z.array(modelCardSchema),
});
export type VendorCardsFile = z.infer<typeof vendorCardsFileSchema>;

export const statRoleSchema = z.enum(['direct', 'scout', 'architect', 'builder', 'critic']);
export type StatRole = z.infer<typeof statRoleSchema>;

export const modelStatSchema = z
  .object({
    source: z.literal('benchmark'),
    round: z.string().min(1),
    measuredOn: isoDateSchema,
    file: z.string().min(1),
    provider: providerIdSchema,
    model: z.string().min(1),
    agentModel: z.string().min(1),
    effort: z.string().nullable(),
    role: statRoleSchema,
    category: cardCategorySchema,
    n: z.number().int().positive(),
    passed: z.number().int().nonnegative(),
    meanCostUsd: z.number().nonnegative(),
    costSource: z.string(),
    meanWallMs: z.number().int().nonnegative(),
    sharedCredit: z.number().int().nonnegative(),
  })
  .refine((stat) => stat.passed <= stat.n && stat.sharedCredit <= stat.n, {
    message: 'passed and sharedCredit cannot exceed n',
  });
export type ModelStat = z.infer<typeof modelStatSchema>;

export const measuredSeedSchema = z.object({
  schemaVersion: z.literal(1),
  generatedAt: isoDateSchema,
  method: z.string(),
  stats: z.array(modelStatSchema),
});
export type MeasuredSeed = z.infer<typeof measuredSeedSchema>;

export const cardStalenessSchema = z.object({
  checkedDaysAgo: z.number().int().nonnegative(),
  checkStale: z.boolean(),
  factsExpired: z.boolean(),
  retiring: z.boolean(),
  retired: z.boolean(),
});
export type CardStaleness = z.infer<typeof cardStalenessSchema>;

export const modelCardViewSchema = z.object({
  card: modelCardSchema,
  offered: z.boolean(),
  isDefault: z.boolean(),
  staleness: cardStalenessSchema,
  jevText: z.string(),
  stats: z.array(modelStatSchema),
});
export type ModelCardView = z.infer<typeof modelCardViewSchema>;

export const providerCardsViewSchema = z.object({
  provider: providerCardSchema,
  connected: z.boolean(),
  hasFrontier: z.boolean(),
  models: z.array(modelCardViewSchema),
  uncardedModels: z.array(z.object({ id: z.string(), label: z.string() })),
});
export type ProviderCardsView = z.infer<typeof providerCardsViewSchema>;

export const modelCardsResponseSchema = z.object({
  checkedAt: isoDateSchema,
  providers: z.array(providerCardsViewSchema),
});
export type ModelCardsResponse = z.infer<typeof modelCardsResponseSchema>;
