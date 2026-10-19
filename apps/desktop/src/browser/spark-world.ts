import type { Cdp } from './cdp.ts';

const WORLD = 'spark-devtools';
const GROUP = 'spark-devtools';

export async function sparkWorld(cdp: Cdp): Promise<number> {
  const { frameTree } = await cdp.send<{ frameTree: { frame: { id: string } } }>(
    'Page.getFrameTree',
  );
  const { executionContextId } = await cdp.send<{ executionContextId: number }>(
    'Page.createIsolatedWorld',
    { frameId: frameTree.frame.id, worldName: WORLD },
  );
  return executionContextId;
}

export async function callOnNode<T>(
  cdp: Cdp,
  world: number,
  backendNodeId: number,
  fn: string,
): Promise<T | null> {
  const resolved = await cdp
    .send<{ object: { objectId?: string } }>('DOM.resolveNode', {
      backendNodeId,
      executionContextId: world,
      objectGroup: GROUP,
    })
    .catch(() => null);
  const objectId = resolved?.object.objectId;
  if (!objectId) return null;
  const { result } = await cdp.send<{ result: { value?: T } }>('Runtime.callFunctionOn', {
    objectId,
    functionDeclaration: fn,
    returnByValue: true,
  });
  return result.value ?? null;
}

export async function runInWorld<T>(
  cdp: Cdp,
  world: number,
  expression: string,
): Promise<T | null> {
  const { result } = await cdp.send<{ result: { value?: T } }>('Runtime.evaluate', {
    expression,
    contextId: world,
    awaitPromise: true,
    returnByValue: true,
  });
  return result.value ?? null;
}

export async function releaseWorld(cdp: Cdp): Promise<void> {
  await cdp.send('Runtime.releaseObjectGroup', { objectGroup: GROUP }).catch(() => undefined);
}
