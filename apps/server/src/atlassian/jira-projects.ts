import { z } from 'zod';
import type { AtlassianClient } from './access.ts';

const projectSchema = z.object({
  id: z.string(),
  key: z.string(),
  name: z.string(),
  projectTypeKey: z.string().optional(),
  style: z.string().optional(),
});
const componentSchema = z.object({ id: z.string(), name: z.string() });
const versionSchema = z.object({
  id: z.string(),
  name: z.string(),
  released: z.boolean().optional(),
  archived: z.boolean().optional(),
  releaseDate: z.string().optional(),
  startDate: z.string().optional(),
  description: z.string().optional(),
  projectId: z.number().optional(),
});
const attachmentSchema = z.object({
  id: z.union([z.string(), z.number()]).transform(String),
  filename: z.string(),
  size: z.number().optional(),
  mimeType: z.string().optional(),
  created: z.string().optional(),
  author: z.object({ displayName: z.string() }).nullable().optional(),
});

export type JiraVersion = z.infer<typeof versionSchema>;
export type JiraAttachment = z.infer<typeof attachmentSchema>;

export interface VersionInput {
  name: string;
  description?: string | undefined;
  startDate?: string | undefined;
  releaseDate?: string | undefined;
}

const project = (key: string) => `/rest/api/3/project/${encodeURIComponent(key)}`;

export function jiraProjects(client: AtlassianClient) {
  return {
    async search(query: string, limit: number) {
      const found = await client.call(
        z.object({ values: z.array(projectSchema) }),
        {
          method: 'GET',
          path: `/rest/api/3/project/search?query=${encodeURIComponent(query)}&maxResults=${limit}`,
        },
        'looking up projects',
      );
      return found.values.map((entry) => ({
        key: entry.key,
        name: entry.name,
        type: entry.projectTypeKey ?? null,
        teamManaged: entry.style === 'next-gen' || entry.style === 'simplified',
      }));
    },
    async project(key: string) {
      return client.call(
        projectSchema,
        { method: 'GET', path: project(key) },
        `reading project ${key}`,
      );
    },
    async components(key: string) {
      return client.call(
        z.array(componentSchema),
        { method: 'GET', path: `${project(key)}/components` },
        `reading the components of ${key}`,
      );
    },
    async versions(key: string): Promise<JiraVersion[]> {
      return client.call(
        z.array(versionSchema),
        { method: 'GET', path: `${project(key)}/versions` },
        `reading the versions of ${key}`,
      );
    },
    async version(id: string): Promise<JiraVersion> {
      return client.call(
        versionSchema,
        { method: 'GET', path: `/rest/api/3/version/${encodeURIComponent(id)}` },
        `reading version ${id}`,
      );
    },
    async createVersion(projectId: string, input: VersionInput): Promise<JiraVersion> {
      return client.call(
        versionSchema,
        {
          method: 'POST',
          path: '/rest/api/3/version',
          body: {
            projectId: Number(projectId),
            name: input.name,
            ...(input.description ? { description: input.description } : {}),
            ...(input.startDate ? { startDate: input.startDate } : {}),
            ...(input.releaseDate ? { releaseDate: input.releaseDate } : {}),
          },
        },
        'creating the version',
      );
    },
    async releaseVersion(id: string, releaseDate: string) {
      await client.call(
        null,
        {
          method: 'PUT',
          path: `/rest/api/3/version/${encodeURIComponent(id)}`,
          body: { released: true, releaseDate },
        },
        `releasing version ${id}`,
      );
    },
    async attachment(id: string): Promise<JiraAttachment> {
      return client.call(
        attachmentSchema,
        { method: 'GET', path: `/rest/api/3/attachment/${encodeURIComponent(id)}` },
        `reading attachment ${id}`,
      );
    },
    async deleteAttachment(id: string) {
      await client.call(
        null,
        { method: 'DELETE', path: `/rest/api/3/attachment/${encodeURIComponent(id)}` },
        `deleting attachment ${id}`,
      );
    },
  };
}

export const attachmentsOf = (value: unknown): JiraAttachment[] =>
  z
    .array(attachmentSchema)
    .catch([])
    .parse(value ?? []);
