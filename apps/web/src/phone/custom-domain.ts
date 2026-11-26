import { CUSTOM_DOMAIN_PROBLEMS, parseSparkAddress } from '@spark-outpost/contracts';

export const DOMAIN_LABEL = 'Domain';
export const DOMAIN_PLACEHOLDER = 'spark.example.com';
export const FORWARD_LABEL = 'Forward requests to';
export const FORWARD_UNKNOWN = "The address is shown once Spark's port is known.";
export const WARNING_LEAD = "Spark can't check that this domain is private.";
export const CONFIRM_LABEL = 'I run this domain and control who can reach it';
export const TURN_ON = 'Turn on';
export const TURN_OFF = 'Turn off';
export const CUSTOM_ON_NOTE = "Reached at your custom domain. Spark can't check who can open it.";
export const PAIR_AGAIN_NOTE = 'Paired devices pair again when the address changes.';
export const REPLACES_TAILSCALE =
  'Tailscale access turns off when you turn this on, and paired devices pair again.';
export const REPLACES_CUSTOM =
  'Turning Tailscale on turns your custom domain off, and paired devices pair again.';
export const CUSTOM_SETUP_NOTE =
  'Use an https address you already run, behind your own reverse proxy or tunnel.';

export const REACH_CHOICE_LABEL = 'How devices reach this computer';
export const FORWARD_NOTE =
  'Your reverse proxy or tunnel sends requests here. Spark still listens on this computer only.';
export const WARNING_TEXT =
  "Anyone who can open it sees this computer's pairing page. Put a sign-in or a private network in front of it. Pairing still needs a code you confirm on this computer.";

export const DOMAIN_PROBLEMS = {
  empty: 'Type the domain your reverse proxy or tunnel serves.',
  scheme: 'The domain must use https.',
  shape: 'Use the domain alone, like spark.example.com, with no port, path, sign-in or query.',
  host: 'Use a domain name like spark.example.com, not an IP address.',
  tailscale: CUSTOM_DOMAIN_PROBLEMS.tailscale,
} as const;

export type ParsedCustomDomain = { ok: true; hostname: string } | { ok: false; problem: string };

export function parseCustomDomain(input: string): ParsedCustomDomain {
  if (input.includes('#')) return { ok: false, problem: DOMAIN_PROBLEMS.shape };
  const parsed = parseSparkAddress(input, null);
  if (!parsed.ok) {
    const problem =
      parsed.problem === 'own' || parsed.problem === 'untrusted' ? 'host' : parsed.problem;
    return { ok: false, problem: DOMAIN_PROBLEMS[problem] };
  }
  if (parsed.reach === 'tailscale') return { ok: false, problem: DOMAIN_PROBLEMS.tailscale };
  return { ok: true, hostname: parsed.hostname };
}
