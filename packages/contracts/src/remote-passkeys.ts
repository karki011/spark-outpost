import { z } from 'zod';

export const PASSKEY_CHALLENGE_TTL_MS = 2 * 60 * 1000;
export const PASSKEY_TICKET_COOKIE = '__Host-spark_passkey';
export const PASSKEY_ALGORITHMS = [-7, -257] as const;

const base64Url = (max: number) =>
  z
    .string()
    .min(1)
    .max(max)
    .regex(/^[A-Za-z0-9_-]+$/);

const credentialId = base64Url(1366);
const clientDataJson = base64Url(4096);
const transport = z.string().min(1).max(32);

const credentialDescriptorSchema = z.object({
  id: z.string(),
  type: z.literal('public-key'),
  transports: z.array(z.string()).optional(),
});

export const passkeyCreationOptionsSchema = z.object({
  rp: z.object({ id: z.string(), name: z.string() }),
  user: z.object({ id: z.string(), name: z.string(), displayName: z.string() }),
  challenge: z.string(),
  pubKeyCredParams: z.array(z.object({ type: z.literal('public-key'), alg: z.number().int() })),
  timeout: z.number().int().positive(),
  attestation: z.literal('none'),
  excludeCredentials: z.array(credentialDescriptorSchema),
  authenticatorSelection: z.object({
    residentKey: z.literal('required'),
    requireResidentKey: z.literal(true),
    userVerification: z.literal('required'),
  }),
});
export type PasskeyCreationOptions = z.infer<typeof passkeyCreationOptionsSchema>;

export const passkeyRequestOptionsSchema = z.object({
  rpId: z.string(),
  challenge: z.string(),
  timeout: z.number().int().positive(),
  userVerification: z.literal('required'),
});
export type PasskeyRequestOptions = z.infer<typeof passkeyRequestOptionsSchema>;

export const passkeyRegistrationSchema = z.object({
  id: credentialId,
  rawId: credentialId,
  type: z.literal('public-key'),
  response: z.object({
    clientDataJSON: clientDataJson,
    attestationObject: base64Url(16_384),
    transports: z.array(transport).max(8).optional(),
  }),
});
export type PasskeyRegistration = z.infer<typeof passkeyRegistrationSchema>;

export const passkeyAssertionSchema = z.object({
  id: credentialId,
  rawId: credentialId,
  type: z.literal('public-key'),
  response: z.object({
    clientDataJSON: clientDataJson,
    authenticatorData: base64Url(2048),
    signature: base64Url(2048),
    userHandle: base64Url(128).optional(),
  }),
});
export type PasskeyAssertion = z.infer<typeof passkeyAssertionSchema>;

export const passkeySignInResponseSchema = z.object({ status: z.literal('signed_in') });
export type PasskeySignInResponse = z.infer<typeof passkeySignInResponseSchema>;
