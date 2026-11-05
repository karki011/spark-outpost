import {
  COMMAND_STORED_CHARS,
  COMMAND_TEXT_MAX,
  outputTail,
  redacted,
  sanitizeOutput,
} from '@spark-outpost/contracts';
import {
  redactValue,
  redactValueWithin,
  storableText,
  withoutFileContent,
} from '../audit/redact.ts';
import { redactSecrets } from '../audit/redact-stream.ts';
import { withoutSecretValues } from '../audit/secret-values.ts';

export function toolArguments(
  input: unknown,
  secret: boolean,
  secretValues: readonly string[],
): string {
  if (input === undefined || input === null) return '';
  const shown = withoutSecretValues(secret ? withoutFileContent(input) : input, secretValues);
  const text = JSON.stringify(redactValueWithin(shown, COMMAND_TEXT_MAX).value) ?? '';
  return text.slice(0, COMMAND_STORED_CHARS);
}

function eachString(value: unknown, change: (text: string) => string): unknown {
  if (typeof value === 'string') return change(value);
  if (Array.isArray(value)) return value.map((item) => eachString(item, change));
  if (value === null || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, child]) => [key, eachString(child, change)]),
  );
}

function resultText(output: unknown, secretValues: readonly string[]): string {
  if (typeof output === 'string') {
    return redactSecrets(storableText(sanitizeOutput(output)), secretValues);
  }
  const safe = withoutSecretValues(redactValue(eachString(output, sanitizeOutput)), secretValues);
  return JSON.stringify(safe) ?? '';
}

export function toolResult(
  output: unknown,
  secret: boolean,
  secretValues: readonly string[],
): string {
  if (output === undefined || output === null || output === '') return '';
  if (secret) return redacted('secret_file');
  return outputTail(resultText(output, secretValues), COMMAND_STORED_CHARS);
}
