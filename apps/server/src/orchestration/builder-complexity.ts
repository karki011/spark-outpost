import type { JevIntake } from '@spark-outpost/contracts';
import { BROAD_SCAN_FILES, BROAD_SCAN_PACKAGES, COMPLEX_JEV_AT } from '../advisor/policy.ts';
import type { ScanReport } from '../codescan/scan.ts';
import { asksForTopModel, complexByRule } from './risk-rules.ts';

export type ComplexSource = 'user' | 'rules' | 'scan' | 'jev';

export interface ComplexSignal {
  source: ComplexSource;
  reason: string;
}

export function complexByRequest(
  request: string | undefined,
  topFamilies: readonly string[] = [],
): ComplexSignal | null {
  if (!request) return null;
  if (asksForTopModel(request, topFamilies)) {
    return { source: 'user', reason: 'asked for the top model' };
  }
  const rule = complexByRule(request);
  return rule ? { source: 'rules', reason: rule } : null;
}

export function complexByScan(report: ScanReport | null | undefined): ComplexSignal | null {
  if (!report) return null;
  const matched = report.candidates.filter((file) => file.termsMatched > 0);
  const packages = new Set(matched.map((file) => file.package).filter((name) => name !== '.'));
  if (packages.size >= BROAD_SCAN_PACKAGES) {
    return { source: 'scan', reason: `matches in ${packages.size} packages` };
  }
  if (matched.length >= BROAD_SCAN_FILES) {
    return { source: 'scan', reason: `matches in ${matched.length} files` };
  }
  return null;
}

export function complexByJev(
  jev: Pick<JevIntake, 'tier' | 'routeConfidence'> | null | undefined,
): ComplexSignal | null {
  const confidence = jev?.routeConfidence ?? null;
  if (jev?.tier !== 'top' || confidence === null || confidence < COMPLEX_JEV_AT) return null;
  return { source: 'jev', reason: `Jev top tier ${confidence.toFixed(2)}` };
}

export function firstSignal(
  ...signals: readonly (ComplexSignal | null | undefined)[]
): ComplexSignal | null {
  return signals.find((signal): signal is ComplexSignal => Boolean(signal)) ?? null;
}
