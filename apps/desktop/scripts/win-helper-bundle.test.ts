import { describe, expect, it } from 'vitest';
import { dotnetProblem } from './win-helper-bundle.ts';

describe('building the Windows helper', () => {
  it('refuses off Windows, since Native AOT cannot cross-compile', () => {
    expect(dotnetProblem('darwin', '8.0.400')).toContain('only on Windows');
  });

  it('needs the .NET 8 SDK or newer', () => {
    expect(dotnetProblem('win32', null)).toContain('dotnet was not found');
    expect(dotnetProblem('win32', '7.0.410')).toContain('dotnet 7.0.410 is installed');
    expect(dotnetProblem('win32', '8.0.404')).toBeNull();
    expect(dotnetProblem('win32', '10.0.100')).toBeNull();
  });
});
