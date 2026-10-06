import type { Express } from 'express';

interface StackLayer {
  route?: { path: string | string[]; methods: Record<string, boolean> };
  handle: { stack?: StackLayer[] };
  matchers: ((path: string) => unknown)[];
}

function mountPrefix(layer: StackLayer): string {
  const underApi = layer.matchers.some((matches) => matches('/api/x'));
  const underRoot = layer.matchers.some((matches) => matches('/x'));
  return underApi && !underRoot ? '/api' : '';
}

function collect(stack: StackLayer[], prefix: string, found: Set<string>): void {
  for (const layer of stack) {
    if (layer.route) {
      const paths = [layer.route.path].flat();
      for (const method of Object.keys(layer.route.methods)) {
        for (const path of paths) found.add(`${method.toUpperCase()} ${prefix}${path}`);
      }
    } else if (layer.handle.stack) {
      collect(layer.handle.stack, prefix + mountPrefix(layer), found);
    }
  }
}

export function registeredRoutes(app: Express): string[] {
  const found = new Set<string>();
  collect((app as unknown as { router: { stack: StackLayer[] } }).router.stack, '', found);
  return [...found].sort();
}
