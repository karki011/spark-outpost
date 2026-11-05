import { VENDOR_CARDS } from '../apps/server/src/model-cards/cards.ts';
import { checkModelCards } from '../apps/server/src/model-cards/check.ts';

const { warnings, failures } = checkModelCards(VENDOR_CARDS, new Date());
for (const line of warnings) console.warn(`WARN ${line}`);
for (const line of failures) console.error(`FAIL ${line}`);
if (failures.length > 0) process.exit(1);
console.log(`Model cards checked as of ${VENDOR_CARDS.checkedAt}; no failures.`);
