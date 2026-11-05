function reportViolation(event: SecurityPolicyViolationEvent): void {
  console.error(
    `Content-Security-Policy violation: ${event.effectiveDirective} blocked ${event.blockedURI || 'inline'}`,
    { source: event.sourceFile, line: event.lineNumber, sample: event.sample },
  );
}

export function reportCspViolationsInDev(): void {
  if (!import.meta.env.DEV) return;
  document.addEventListener('securitypolicyviolation', reportViolation);
}
