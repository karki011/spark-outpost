import { parentPort } from 'node:worker_threads';
import { readAndParse, type FileJob, type FileResult } from './read-file.ts';

export interface ParseRequest {
  id: number;
  root: string;
  files: FileJob[];
}

export interface ParseResponse {
  id: number;
  results: FileResult[];
}

async function parseAll(request: ParseRequest): Promise<ParseResponse> {
  const results: FileResult[] = [];
  for (const job of request.files) {
    const result = await readAndParse(request.root, job).catch((): FileResult => ({
      path: job.path,
      status: 'missing',
    }));
    results.push(result);
  }
  return { id: request.id, results };
}

let chain: Promise<void> = Promise.resolve();

parentPort?.on('message', (request: ParseRequest) => {
  chain = chain.then(async () => parentPort?.postMessage(await parseAll(request)));
});
