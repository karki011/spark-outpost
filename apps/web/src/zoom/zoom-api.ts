import {
  googleSignInFlowSchema,
  zoomDisconnectedSchema,
  zoomStatusSchema,
  type GoogleSignInFlow,
  type ZoomDisconnected,
  type ZoomStatus,
} from '@spark-outpost/contracts';
import { request } from '../api/client.ts';

export const zoomKeys = { status: ['zoom', 'status'] as const };

export const zoomApi = {
  status: (): Promise<ZoomStatus> => request(zoomStatusSchema, '/zoom/status'),
  startSignIn: (): Promise<GoogleSignInFlow> =>
    request(googleSignInFlowSchema, '/zoom/sign-in', { method: 'POST', body: '{}' }),
  cancelSignIn: (): Promise<GoogleSignInFlow> =>
    request(googleSignInFlowSchema, '/zoom/sign-in', { method: 'DELETE' }),
  disconnect: (): Promise<ZoomDisconnected> =>
    request(zoomDisconnectedSchema, '/zoom/account', { method: 'DELETE' }),
};
