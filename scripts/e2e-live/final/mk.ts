import { BASE, LINKED } from './fixtures.ts';
import { makeRepo } from './lib.ts';

console.log(makeRepo(process.argv[2]!, process.argv[3] === 'linked' ? LINKED : BASE));
