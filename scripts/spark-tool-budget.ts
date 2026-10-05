import {
  advertisedSize,
  estimatedTokens,
  SESSION_CASES,
  type SessionCase,
} from '../apps/server/test/spark-tool-sizes.ts';

async function main(): Promise<void> {
  for (const name of Object.keys(SESSION_CASES) as SessionCase[]) {
    const size = await advertisedSize(SESSION_CASES[name]);
    console.log(
      `${name}: ${size.tools} tools, ${size.chars} chars, ~${size.tokens} tokens (chars/4); instructions ${size.instructionChars} chars, ~${estimatedTokens(size.instructionChars)} tokens`,
    );
    for (const [group, chars] of Object.entries(size.groups)) {
      console.log(`  ${group}: ${chars} chars, ~${estimatedTokens(chars)} tokens`);
    }
  }
}

await main();
