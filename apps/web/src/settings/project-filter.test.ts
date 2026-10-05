import { describe, expect, it } from 'vitest';
import type { Project } from '@spark-outpost/contracts';
import { countLabel, filterProjects } from './project-filter.ts';

const project = (name: string, rootPath: string): Project => ({
  id: `00000000-0000-4000-8000-${name.length.toString().padStart(12, '0')}`,
  name,
  rootPath,
  displayPath: rootPath.replace('/Users/hazel', '~'),
  createdAt: '2026-10-01T00:00:00Z',
  commandAllowlist: [],
});

const api = project('api', '/Users/hazel/work/api');
const web = project('web-console', '/Users/hazel/work/clients/web-console');
const docs = project('docs', '/Users/hazel/notes/docs');

describe('project filter', () => {
  it('keeps every project when the filter is blank', () => {
    expect(filterProjects([api, web], '   ')).toEqual([api, web]);
  });

  it('matches the name or the path, ignoring case, and needs every word', () => {
    expect(filterProjects([api, web, docs], 'WEB')).toEqual([web]);
    expect(filterProjects([api, web, docs], 'work')).toEqual([api, web]);
    expect(filterProjects([api, web, docs], '~/notes')).toEqual([docs]);
    expect(filterProjects([api, web, docs], 'work console')).toEqual([web]);
    expect(filterProjects([api, web, docs], 'missing')).toEqual([]);
  });

  it('counts what the filter shows', () => {
    expect(countLabel(15, 15)).toBe('15 projects');
    expect(countLabel(2, 15)).toBe('2 of 15 projects');
  });
});
