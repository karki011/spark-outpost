import path from 'node:path';
import { toGatePath } from '../../approvals/gate-path.ts';

export const gateAbs = (target: string) => toGatePath(path.resolve(target));
