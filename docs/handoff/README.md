# Lane handoff notes

Each lane writes **only** its own file here: `docs/handoff/<lane>.md` (`corea`, `coreb`, `corec`, `cored`, `coree`, `mobs`, `inv`, `audio`, `menus`, `kid`, `mech`, `fx`). `tools/lane-worktree.mjs` creates it in the lane's worktree. Lanes never edit `docs/STATUS.md`; the integrator merges the lane branches and copies verified results into it (SPEC §0.1).

Newest entry first. Each entry has:

- **Date · what changed** (files, stubs deleted).
- **Commands run and their results**: paste the `PASS`/`FAIL`/`PENDING` lines of `node tools/smoke.mjs --tag <lane>` and the `ℹ pass`/`ℹ fail` lines of `npm run test:unit`.
- **Remaining** work, by priority (P0, P1, P2).
- **Blockers** (a missing API from another lane, an unavailable device).
- **Spec conflicts**: anything in the code that disagrees with `docs/SPEC.md`. Do not quietly pick one.
- **New events or API members** you added (lane prefix), so the integrator can document them in the SPEC.
