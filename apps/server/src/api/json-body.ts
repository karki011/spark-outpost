import express, { type RequestHandler } from 'express';
import { RequestTooLargeError, isTooLarge } from './validation.ts';

const REQUEST_BODY_MAX_BYTES = 256 * 1024;
const MESSAGE_BODY_MAX_BYTES = 16 * 1024 * 1024;
const CREW_FILE_BODY_MAX_BYTES = 2 * 1024 * 1024;

const CREW_FILE_PATHS = [/^\/api\/teammates(?:\/[^/]+(?:\/files)?)?$/];

const MESSAGE_PATHS = [
  /^\/api\/conversations\/[^/]+\/messages$/,
  /^\/api\/conversations\/[^/]+\/queue(?:\/[^/]+)?$/,
  /^\/api\/runs\/[^/]+\/messages$/,
];

const MESSAGE_TOO_LARGE =
  'This message is over 16 MB, more than Spark can receive in one request. Shorten it and send again.';
const REQUEST_TOO_LARGE = 'That request is too large.';

export function carriesMessageText(path: string): boolean {
  return MESSAGE_PATHS.some((pattern) => pattern.test(path));
}

export function carriesCrewFile(path: string): boolean {
  return CREW_FILE_PATHS.some((pattern) => pattern.test(path));
}

export function jsonBody(): RequestHandler {
  const small = express.json({ limit: REQUEST_BODY_MAX_BYTES });
  const message = express.json({ limit: MESSAGE_BODY_MAX_BYTES });
  const crewFile = express.json({ limit: CREW_FILE_BODY_MAX_BYTES });
  return (req, res, next) => {
    const forMessage = carriesMessageText(req.path);
    const parse = forMessage ? message : carriesCrewFile(req.path) ? crewFile : small;
    parse(req, res, (error?: unknown) => {
      if (!isTooLarge(error)) {
        next(error);
        return;
      }
      next(new RequestTooLargeError(forMessage ? MESSAGE_TOO_LARGE : REQUEST_TOO_LARGE));
    });
  };
}
