const FEEDBACK_EMAIL = '';
const FEEDBACK_REPO = '';

export interface FeedbackTarget {
  email: string;
  repo: string;
}

type BuildEnv = Record<string, string | boolean | undefined>;

function setting(env: BuildEnv, name: string, fallback: string): string {
  const value = env[name];
  return (typeof value === 'string' && value.trim() !== '' ? value : fallback).trim();
}

export function feedbackTarget(env: BuildEnv = import.meta.env): FeedbackTarget {
  return {
    email: setting(env, 'VITE_SPARK_FEEDBACK_EMAIL', FEEDBACK_EMAIL),
    repo: setting(env, 'VITE_SPARK_FEEDBACK_REPO', FEEDBACK_REPO).replace(
      /^https:\/\/github\.com\//,
      '',
    ),
  };
}
