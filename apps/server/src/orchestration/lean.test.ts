import { describe, expect, it } from 'vitest';
import {
  architectStyle,
  builderStyle,
  criticStyle,
  harvestShortcuts,
  lowerOf,
  reviewNet,
  ruleBuildStyle,
  splitMarker,
  withBuilderStyle,
} from './lean.ts';
import { builderPrompt, criticFollowUp, criticPrompt } from './context.ts';

const PATCH = `diff --git a/src/rates.ts b/src/rates.ts
index 1111111..2222222 100644
--- a/src/rates.ts
+++ b/src/rates.ts
@@ -10,3 +10,6 @@ export async function fetchRates(currency: string) {
 const seen = new Map();
-// lean: an old marker that was removed
+// lean: in-memory only; upgrade: move to Redis when there are several servers
+const cache = new Map<string, Rates>();
 context line
+  # lean: global lock, per-account locks if throughput matters
diff --git a/src/Form.tsx b/src/Form.tsx
new file mode 100644
--- /dev/null
+++ b/src/Form.tsx
@@ -0,0 +1,3 @@
+{/* lean: native date input, no custom picker */}
+const note = "the lean: convention is documented in LEAN_BUILD.md";
+<input type="date" />
diff --git a/src/gone.ts b/src/gone.ts
deleted file mode 100644
--- a/src/gone.ts
+++ /dev/null
@@ -1 +0,0 @@
-// lean: deleted with the file
`;

describe('build style prompts', () => {
  it('adds nothing when the style is off', () => {
    expect(architectStyle('off')).toBeNull();
    expect(builderStyle('off')).toBeNull();
    expect(criticStyle('off')).toBeNull();
    expect(withBuilderStyle('Fix it.', 'off')).toBe('Fix it.');
  });

  it('gives the Architect the first two rungs and the Reuse line', () => {
    const lean = architectStyle('lean')!;
    expect(lean).toContain('needs to exist at all');
    expect(lean).toContain('the codebase already has');
    expect(lean).toContain('"Reuse: <file or function>"');
    expect(lean).not.toContain('standard library');
  });

  it('gives the Builder the full ladder, the safety floor, markers and one check', () => {
    const lean = builderStyle('lean')!;
    for (const rung of ['1. Does it need to exist?', '4. Does the platform', '7. Only then']) {
      expect(lean).toContain(rung);
    }
    expect(lean).toContain('Fix a bug at its root');
    expect(lean).toContain('Never trim input validation at trust boundaries');
    expect(lean).toContain('`// lean: ');
    expect(lean).toContain('Leave one runnable check');
    const lite = builderStyle('lite')!;
    expect(lite).toContain('Build what the request asks, completely');
    expect(lite).toContain('Never trim input validation');
    expect(lite).not.toContain('7. Only then');
  });

  it('puts the style at the end of a planned Builder prompt and after an in-place request', () => {
    const prompt = builderPrompt({
      request: 'Add a date field',
      plan: ['Edit src/Form.tsx'],
      stepIndex: 0,
      earlierChanges: [],
      note: null,
      findings: [],
      buildStyle: 'lean',
    });
    expect(prompt.trimEnd().endsWith(builderStyle('lean')!)).toBe(true);
    expect(withBuilderStyle('Add a date field', 'lite')).toBe(
      `Add a date field\n\n${builderStyle('lite')}`,
    );
  });

  it('adds the complexity lens to the one Critic pass and its follow-ups', () => {
    const context = { changes: [], patch: '', checks: [], buildStyle: 'lean' as const };
    const first = criticPrompt({ request: 'r', plan: [], ...context });
    const next = criticFollowUp(context);
    for (const prompt of [first, next]) {
      expect(prompt).toContain('## Complexity (same review)');
      expect(prompt).toContain('"net: -N lines possible"');
      expect(prompt).toContain('Complexity findings alone do not make the verdict concerns');
    }
    expect(criticPrompt({ request: 'r', plan: [], ...context, buildStyle: 'off' })).not.toContain(
      'Complexity',
    );
  });
});

describe('the rule for a turn’s build style', () => {
  it('never goes above the project setting', () => {
    expect(ruleBuildStyle('off', 'do', 'Add a cache')).toEqual({
      style: 'off',
      reason: 'project setting',
    });
    expect(ruleBuildStyle('lite', 'do', 'Add a cache').style).toBe('lite');
    expect(lowerOf('lean', 'lite')).toBe('lite');
    expect(lowerOf('off', 'lite')).toBe('off');
  });

  it('turns off outside Do and eases to lite when the request asks for a complete version', () => {
    expect(ruleBuildStyle('lean', 'ask', 'Explain the cache').style).toBe('off');
    expect(ruleBuildStyle('lean', 'do', 'Build a full-featured date picker')).toEqual({
      style: 'lite',
      reason: 'asks for a complete version',
    });
    expect(ruleBuildStyle('lean', 'do', 'Make it production-ready').style).toBe('lite');
    expect(ruleBuildStyle('lean', 'do', 'Add a date input').style).toBe('lean');
  });
});

describe('harvesting lean: markers', () => {
  it('reads added comment markers with their new line numbers', () => {
    expect(harvestShortcuts(PATCH)).toEqual([
      {
        path: 'src/rates.ts',
        line: 11,
        ceiling: 'in-memory only',
        upgrade: 'move to Redis when there are several servers',
      },
      {
        path: 'src/rates.ts',
        line: 14,
        ceiling: 'global lock',
        upgrade: 'per-account locks if throughput matters',
      },
      {
        path: 'src/Form.tsx',
        line: 1,
        ceiling: 'native date input',
        upgrade: 'no custom picker',
      },
    ]);
  });

  it('flags a marker with no upgrade trigger', () => {
    expect(splitMarker('naive O(n²) scan')).toEqual({ ceiling: 'naive O(n²) scan', upgrade: null });
    expect(splitMarker('fixed TTL. Upgrade: make it configurable when asked.')).toEqual({
      ceiling: 'fixed TTL',
      upgrade: 'make it configurable when asked',
    });
  });

  it('finds nothing in an empty diff', () => {
    expect(harvestShortcuts('')).toEqual([]);
  });
});

describe('the Critic’s net line', () => {
  it('reads how many lines could go', () => {
    expect(
      reviewNet('Findings:\n- L3: stdlib: …\nnet: -12 lines possible\nVerdict: looks good'),
    ).toBe(-12);
    expect(reviewNet('**net:** -3 lines possible\nVerdict: looks good')).toBe(-3);
    expect(reviewNet('net: 0\nVerdict: looks good')).toBe(0);
    expect(reviewNet('Verdict: looks good')).toBeNull();
  });
});
