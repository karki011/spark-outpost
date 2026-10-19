import { z } from 'zod';

export const ATLASSIAN_NAME = 'Atlassian';

export const atlassianProductIdSchema = z.enum(['jira', 'confluence']);
export type AtlassianProductId = z.infer<typeof atlassianProductIdSchema>;

export const atlassianProductNames: Record<AtlassianProductId, string> = {
  jira: 'Jira',
  confluence: 'Confluence',
};

export const atlassianReachSchema = z.enum(['reachable', 'denied', 'unchecked']);
export type AtlassianReach = z.infer<typeof atlassianReachSchema>;

export const atlassianProductSchema = z.object({
  reach: atlassianReachSchema,
  on: z.boolean(),
});
export type AtlassianProduct = z.infer<typeof atlassianProductSchema>;

export const atlassianProductsSchema = z.object({
  jira: atlassianProductSchema,
  confluence: atlassianProductSchema,
});
export type AtlassianProducts = z.infer<typeof atlassianProductsSchema>;

export function atlassianProductLive(product: AtlassianProduct | undefined): boolean {
  return product?.on === true && product.reach === 'reachable';
}

export const CONFLUENCE_PAGE_ID = /^\d{1,20}$/;
export const confluencePageIdSchema = z
  .string()
  .trim()
  .regex(CONFLUENCE_PAGE_ID, 'Pass a Confluence page id (digits).');

export const CONFLUENCE_TITLE_MAX = 255;
export const ATLASSIAN_BODY_MAX = 60_000;
export const ATLASSIAN_QUERY_MAX = 2_000;
