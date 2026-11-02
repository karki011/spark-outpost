import {
  ASK_SPARK_SCOPE,
  advertisedSize,
  estimatedTokens,
  SESSION_CASES,
  type SessionCase,
} from '../apps/server/test/spark-tool-sizes.ts';

async function report(label: string, name: SessionCase, askSpark: boolean): Promise<void> {
  const size = await advertisedSize(SESSION_CASES[name], askSpark ? ASK_SPARK_SCOPE : undefined);
  console.log(
    `${label}: ${size.tools} tools, ${size.chars} chars, ~${size.tokens} tokens (chars/4); instructions ${size.instructionChars} chars, ~${estimatedTokens(size.instructionChars)} tokens`,
  );
  for (const [group, chars] of Object.entries(size.groups)) {
    console.log(`  ${group}: ${chars} chars, ~${estimatedTokens(chars)} tokens`);
  }
}

async function main(): Promise<void> {
  for (const name of Object.keys(SESSION_CASES) as SessionCase[]) {
    await report(name, name, false);
    await report(`Ask Spark, ${name}`, name, true);
  }
}

await main();
