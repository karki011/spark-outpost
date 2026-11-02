# Spark chat inspector preview

Source baseline: `main` at `0232cff9bd0293d780f1d1be2618051f3ae3fb0e`.

Start from the repository root with `SPARK_WEB_PORT=5187 pnpm --filter @spark-outpost/web dev`, then open `http://127.0.0.1:5187/chat-preview.html`.

This separate Vite entry imports Spark's real Rail, ProviderBlob, TicketsHeader, icons, fonts, base styles and theme tokens. The conversation and inspector arrangement are proposed UI with sample data. The preview is separate from the production entry. API requests from this preview are intercepted locally; buttons do not message real agents, sync Jira, or use credentials.

The toolbar switches between Chat, Agent TV, Sign-in and Tickets. Agent TV supports selecting an agent, simulated messaging, stop/resume and Stage/List. Sign-in demonstrates approving an exact additional origin and a simulated successful login. Tickets lets the reviewer hold sync open while searching, selecting rows or navigating, then simulate completion or failure.

Verified in the browser: desktop layout at 1440 × 1000, narrow layout at 390 × 844, warm dark and light themes, agent message delivery simulation, saved-sign-in simulation, ticket search and selection during sync, and retained search/selection after simulated failure. The preview entry and its imports pass TypeScript checking with Vite client types.

The reported live ticket interaction blocker has not been reproduced or fixed. This preview does not validate production login or agent execution; the production changes in this branch are tested separately. The older checkout at `/Users/ada/Documents/spark-outpost` was not modified.
