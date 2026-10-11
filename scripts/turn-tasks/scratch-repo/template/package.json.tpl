{
  "name": "ledger-scratch",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "node --test \"test/**/*.spec.ts\"",
    "test:pricing": "node --test \"test/pricing/*.spec.ts\"",
    "test:stock": "node --test \"test/stock/*.spec.ts\"",
    "test:text": "node --test \"test/text/*.spec.ts\"",
    "lint": "eslint .",
    "typecheck": "tsc --noEmit",
    "ticker": "node scripts/ticker.mjs",
    "check:slow": "node scripts/slow-check.mjs",
    "dev": "node scripts/dev-server.mjs"
  }
}
