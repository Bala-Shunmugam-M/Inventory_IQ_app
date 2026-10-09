# Handoff — sync & demand fixes from external review #2

Branch: `audit-upgrade` (PR #1). Base commit for this work: `efd5dc3`.
All findings below were checked against the code and are real. Each has an
acceptance test that must be added and pass.

## Ground rules

- **A separate UI branch is being built (ChatGPT): wording, larger controls,
  "I placed this order" / "Stock arrived" buttons, stable sales rows.** Don't
  restyle or relabel anything. Keep edits to:
  `docs/iq-core.js`, `mobile/src/lib/storage.js`, `mobile/src/lib/cloud.js`,
  `backend/**`, `tests/**`. The only HTML edits allowed are inside the
  sync handlers (`doSyncCloud`/`doRestoreCloud` in index.html,
  `syncToCloud`/`restoreFromCloud` in dashboard.html) and the body of
  `markOrdered` in both pages.
- UI work that this needs (the "Finished entering today's sales" button) is
  delivered as a core function the UI branch calls — see task 5.
- The web core and the mobile engine must stay identical in behaviour:
  extend `tests/mobile-parity.mjs` for every change.
- Run before committing:
  `node tests/check.mjs && node tests/sync.mjs && node tests/mobile-parity.mjs && node backend/test/run.mjs`

## Tasks

### 1. Baseline must be an immutable copy (High)
`iqSetBase` stores references to live `PRODS` objects, so page edits also change
the "last synced" base. Deep-copy in `iqSetBase` and in `iqPull().commit`.
Mobile already round-trips through JSON; double-check.
**Test** (in tests/sync.mjs, mutating the same objects the pages mutate): devices
A and B start at stock 20, A sells 3 via `iqRecordDay`, B sells 4, both sync →
stock **13**.

### 2. Replace counter-delta merging with event replay (High — fixes 3 findings)
Current `iqMerge3` adds `Δlocal + Δremote` for stock/incoming. Wrong when:
a lost PUT response is retried (20 − 3 − 3 = **14**, should be 17); two devices
receive the same delivery (stock +20 instead of +10); two people correct the
same shelf count 20→18 (**16**, should be 18). It also takes one device's whole
`history`, losing the other's days (base `[10]`, A logs Oct 2, B logs Oct 3 →
`[10,4]`).

Design:
- Every stock-changing action becomes an **event** with a unique id (`iqUid()`)
  and timestamp `t`, recorded inside core functions (no new UI):
  - `sale {id,t,day,pid,q,cens}` — in `iqRecordDay` (and mobile `recordSales`)
  - `order {id,t,pid,q}` — new `iqMarkOrdered(p, q)`; pages' `markOrdered` calls it
  - `receive {id,t,pid,q}` — in `iqReceive`; on replay `q = min(q, incoming)` so a
    delivery received on two devices only counts once
  - `adjust {id,t,pid,stock,incoming}` — absolute correction. Not recorded at
    edit time: at push time, if `product.stock` ≠ replay(base, local events),
    synthesize one (the edit forms stay untouched)
  - `close {id,t,day}` — task 5
- Local log in localStorage `iq_events` (mobile: AsyncStorage), trimmed to
  ~3000 events / 120 days. Snapshot PUT body gains `events`; backend stores and
  returns it (new column `events TEXT NOT NULL DEFAULT '[]'` in
  `backend/schema.sql`; validate: array ≤ 5000 objects with string `id`).
- On 409: `events = union(base.events, remote.events, local.events)` by id; for
  each product rebuild `stock`, `incoming` and `history/histCens/histDay` by
  replaying events newer than the base (sorted by `t`, then `day`) on the base
  product, reusing `iqLogSale` so history matches the non-merge path. Keep the
  existing field-level 3-way merge for all other fields and for add/delete.
- If both sides have `adjust` events for one product with different values,
  keep the later one and return it in `result.conflicts` (`[{name, kept}]`); the
  page sync handler toasts "Stock for X differed between devices — kept N,
  please recount".
- Retries become idempotent automatically: our own already-landed events are
  in `remote.events`, so the union doesn't apply them twice.

**Tests**: the four numbers above (17 after a lost response, +10 for a shared
delivery, 18 for two corrections, `[10,3,4]` history), mirrored in
`mobile-parity.mjs`.

### 3. Sold-out days are lower bounds, not discarded (High)
Discarding censored days biases demand down (alternating 2 uncensored / 20 sold
out → **2/day**, observed ~11). In `iqDemand`/`iqSigma` (mobile
`planDemand`/`demandSigma`) use a censor-aware estimate, e.g. iterate
`d = mean(x_i if uncensored else max(x_i, d))` from `d = mean(all)` to a
fixed point. Blend weight with the typed demand = uncensored count / `minHistory`;
no uncensored days → keep the typed estimate.
**Tests**: alternating case → ~11; seven censored 2s with typed 10 → 10.

### 4. Forecast must respect censoring (Medium)
Seven sold-out observations of 2 give planning demand 10 but forecast 2,
accuracy 100%, band 0. Feed `iqFcNext`/backtest the censor-imputed series from
task 3, and only score backtest targets that are uncensored (`acc = null` when
fewer than 3). Same in mobile `forecastProduct`.

### 5. Partial entry must not declare zeros (High)
`iqRecordDay` currently logs a zero day for every product not entered. Change:
only entered products are logged. Add `iqCompleteDay(ps, today)` (mobile
`completeDay()`): logs a `close` event and a 0 bucket for each product with no
sale that day (censored if stock is 0). It must work on a day with no sales at
all. **The UI branch wires a "Finished entering today's sales" button to it** —
note this in the PR.
**Tests**: entering one product per day for a week leaves the others' demand at
their typed value; `iqCompleteDay` on an all-zero day logs zeros.

### 6. Empty saved catalog must be restorable (Medium)
Restore handlers treat `data.length === 0` as "nothing saved". `iqPull` returns
`null` only when the store has never been saved (`version 0`); handlers should
then allow an empty snapshot to clear the catalog after confirmation.

### 7. Locally typed names reach innerHTML (Medium)
Add/edit forms store raw strings that render as HTML before the next reload.
Without touching the forms: strip `<`/`>` from every string field in place inside
`iqRecompute` (every add/edit/delete path calls it via `recomputeAllStatus`).
Verify in the browser: an image-onerror payload typed as a name doesn't run, on both
pages.

### 8. Mobile mutations must report failure (Medium)
`addProduct`/`updateProduct`/`deleteProduct` ignore `saveProducts() === false`.
Return `null` on failure. In `cloud.js` set `SYNC.busy = true` **before**
`loadProducts()` so no save lands between capture and lock.

## Done when
All four suites pass with the new tests, both pages show no console errors
across all screens (serve with `python -m http.server 8765 --directory docs`), and PR #1
has a commit summarising tasks 1–8 plus a note for the UI branch about
`iqCompleteDay` / `completeDay`.
