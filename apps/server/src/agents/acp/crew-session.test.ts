import { describe, expect, it } from 'vitest';
import type { SparkSessionPrefs, TeammateBrief } from '@spark-outpost/contracts';
import { crewFolderRules, guardedCrewFolders } from '../../approvals/crew-folders.ts';
import { tempRoots } from '../../approvals/temp-dirs.ts';
import { claudeSessionMeta } from './agents.ts';
import { CLAUDE_DO_TOOLS, CLAUDE_READ_TOOLS } from './claude-tools.ts';
import { codexPermissionProfiles } from './codex-permissions.ts';
import type { SparkFloor } from '../../spark-rules/floor-flags.ts';
import { NO_CLAUDE_REPO } from './repo-session.ts';
import {
  sparkInstructions,
  sparkReadDirs,
  teammateBriefText,
  withClaudeSpark,
  withCodexSpark,
} from './spark-instructions.ts';

const FOLDER = '/data/dev/sparks/11111111-1111-4111-8111-111111111111';
const PREFS: SparkSessionPrefs = {
  displayName: 'Sam',
  personality: 'facts',
  agentInstructions: '',
};
const WREN: TeammateBrief = {
  name: 'Wren',
  role: 'Reviewer',
  instructions: 'Review carefully.',
  folder: FOLDER,
  skills: [
    { name: 'review', description: 'Review a diff', folder: `${FOLDER}/skills/review` },
    { name: 'audit', description: 'Audit dependencies', folder: `${FOLDER}/skills/audit` },
  ],
};

interface ClaudePermissions {
  deny: string[];
  additionalDirectories: string[];
}

function claudeOptions(meta: Record<string, unknown>) {
  const { options } = meta.claudeCode as {
    options: { disallowedTools: string[]; settings: { permissions: ClaudePermissions } };
  };
  return { disallowed: options.disallowedTools, permissions: options.settings.permissions };
}

describe('the brief lists a Spark’s skills', () => {
  it('names each skill with its description and the folder to read', () => {
    const text = teammateBriefText(WREN);
    expect(text).toContain('Review carefully.');
    expect(text).toContain(`- review: Review a diff (${FOLDER}/skills/review)`);
    expect(text).toContain(`- audit: Audit dependencies (${FOLDER}/skills/audit)`);
    expect(text).toContain('read its SKILL.md before using the skill');
    expect(text).toContain('Never change, move or delete');
    expect(text.indexOf('Review carefully.')).toBeLessThan(text.indexOf('- review:'));
  });

  it('says nothing about skills when the Spark has none', () => {
    for (const skills of [undefined, []]) {
      const text = teammateBriefText({ ...WREN, ...(skills ? { skills } : { skills: [] }) });
      expect(text).not.toContain('Skills');
      expect(text.trimEnd().endsWith('Review carefully.')).toBe(true);
    }
  });

  it('reaches Claude in the appended prompt and Codex in developer instructions', () => {
    const prefs = { ...PREFS, teammate: WREN };
    expect(sparkInstructions(prefs, true)).toContain('- review: Review a diff');
    expect(withClaudeSpark(null, prefs, true)!.appendPrompt).toContain('- audit: Audit');
    expect(withCodexSpark(null, prefs)!.developerInstructions).toContain('- audit: Audit');
  });
});

describe('Claude may read every crew folder and never edit them', () => {
  const CREW = ['/data/dev/sparks', '/data/dev/workflows'];

  it('opens the Spark’s own folder and the whole crew, in every turn', () => {
    expect(sparkReadDirs({ ...PREFS, teammate: WREN }, CREW)).toEqual([FOLDER, ...CREW]);
    expect(sparkReadDirs({ ...PREFS, teammate: { ...WREN, folder: null } }, CREW)).toEqual(CREW);
    expect(sparkReadDirs(PREFS, CREW)).toEqual(CREW);
    expect(sparkReadDirs(undefined, CREW)).toEqual(CREW);
    expect(withClaudeSpark(null, { ...PREFS, teammate: WREN }, true)!.readDirs).toContain(FOLDER);
    expect(withClaudeSpark(null, PREFS, true)!.readDirs).toEqual(guardedCrewFolders());
  });

  it('adds the folder to the readable directories of the session', () => {
    const repo = { ...NO_CLAUDE_REPO, readDirs: [FOLDER] };
    const { permissions } = claudeOptions(claudeSessionMeta(CLAUDE_READ_TOOLS, [], repo));
    expect(permissions.additionalDirectories).toEqual([...tempRoots(), FOLDER]);
    const plain = claudeOptions(claudeSessionMeta(CLAUDE_READ_TOOLS, [], NO_CLAUDE_REPO));
    expect(plain.permissions.additionalDirectories).toEqual([
      ...tempRoots(),
      ...guardedCrewFolders(),
    ]);
  });

  it.each([
    ['a read turn', CLAUDE_READ_TOOLS, false, false],
    ['a Do turn', CLAUDE_DO_TOOLS, true, false],
    ['a Do turn that may bypass permissions', CLAUDE_DO_TOOLS, true, true],
  ] as const)('denies edits of the crew folders in %s', (_name, tools, changes, bypass) => {
    const repo = { ...NO_CLAUDE_REPO, readDirs: [FOLDER] };
    const { disallowed, permissions } = claudeOptions(
      claudeSessionMeta(tools, [], repo, changes, bypass, []),
    );
    const rules = crewFolderRules();
    expect(rules).toHaveLength(guardedCrewFolders().length * 2);
    expect(rules.length).toBeGreaterThanOrEqual(4);
    expect(permissions.deny).toEqual(expect.arrayContaining(rules));
    expect(disallowed).toEqual(expect.arrayContaining(rules));
  });

  it('keeps the deny rules when the user’s Spark rules file is empty', () => {
    const floor: SparkFloor = {
      secretEdits: false,
      forcePush: false,
      remotes: null,
      instructions: null,
      gitConfig: null,
    };
    const repo = { ...NO_CLAUDE_REPO, floor };
    const meta = claudeSessionMeta(CLAUDE_DO_TOOLS, [], repo, true, true, []);
    expect(claudeOptions(meta).permissions.deny).toEqual(expect.arrayContaining(crewFolderRules()));
  });
});

describe('Codex may read crew folders and never write them', () => {
  it('marks the folders read-only in every profile', () => {
    const profiles = codexPermissionProfiles() as Record<
      string,
      { filesystem: Record<string, unknown> }
    >;
    for (const folder of guardedCrewFolders()) {
      for (const profile of Object.values(profiles)) {
        expect(profile.filesystem[folder]).toBe('read');
      }
    }
  });
});
