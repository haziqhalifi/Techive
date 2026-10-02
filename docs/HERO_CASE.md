# Hero case — Level 23 "too hot" during chiller plant drift

One case carries the whole demo. Every number below is derived, not asserted: the chiller series is
generated deterministically from `HARVEST_SEED` (`backend/src/modules/synthetic/world.dataset.ts`),
and the figures are computed from that raw telemetry by
`backend/src/modules/analytics/analytics.service.ts`.

## The situation

| | |
|---|---|
| Site | Tower K (`site-towerk`), synthetic Singapore Grade-A office, 42,000 m² GFA |
| Complaint | Level 23, zone North — *"too hot and stuffy at 14:40"* |
| Reported temperature | 26.5 °C against a target of 23 °C |
| Tenant | Level 23 lease, comfort band 22.5–24.5 °C, Mon-Fri 08:00–19:00 |
| Plant | Chiller plant `CP-1`; the controlling asset for L23 is `AHU L23` |
| Observed | chiller efficiency drifted **0.6230 → 0.7130 kW/RT** over 14 days |
| Tariff | SGD 0.28 / kWh |

`world.dataset.ts` generates **14 days × 96 intervals = 1,344 readings**. Each day's mean walks
linearly from 0.6230 to 0.7130, and per-reading noise is zero-mean *within each day*, so the daily
means land on the target line regardless of the random draw. `summariseReadings` recovers day-1 and
day-14 means from the raw series, which is why the card's numbers cannot drift from the data.

## What the pipeline does

| Step | Node | Result |
|---|---|---|
| 1 | `parse_case` | floor 23, observed 14:40, symptom `too_hot`, target 23 °C, 16 case tokens |
| 2 | `evaluate_gate` | **clear** — no safety, odour, illness or Legionella signal, no out-of-band setpoint |
| 3 | `check_context` | no transfer requested, so context is deferred to the selected pill |
| 4 | `select_pill` | `chiller-plant-staging-drift` (`pill-0001`), score 0.71, **not** model-assisted |
| 5 | `validate_context` | **compatible** — `ahu` is an allowed asset type, plant `CP-1`, tariff 0.28, GFA ≥ 30,000 |
| 6 | `compute_metrics` | the numbers in the table below |
| 7 | `assemble_card` | 4 priced options |
| 8 | `route_action` | **execute_with_approval** — the selected option needs sign-off |

Hop log on the returned card:

```
parse_case → evaluate_gate → check_context → select_pill
→ validate_context → compute_metrics → assemble_card → route_action
```

## The numbers (computed from telemetry, never produced by the model)

```
drift      = 0.7130 − 0.6230        = 0.0900 kW/RT   (14.4% worse)
excess_kw  = 0.0900 × 850 RT        = 76.5 kW
excess_kwh = 76.5 × 24 h            = 1,836.0 kWh
excess_sgd = 1,836.0 × S$0.28       = S$514.08
weather-normalised = 1,836.0 × (15.1844 / 17.5) = 1,593.06 kWh  (S$446.06)
```

The weather correction uses the shoulder-month cooling-degree-day ratio: the observation window ran
hotter than the seasonal norm, so part of the excess is weather rather than plant degradation.
Presenting the raw 1,836 kWh without that correction would overstate the recoverable saving.

## The options, ranked by the policy hierarchy

| Option | kWh | SGD | Policy tier | Tier | Outcome |
|---|---|---|---|---|---|
| Re-sequence chiller staging (lead/lag rotation) | −4,590 | **−1,285.20** | Lease comfort (2) | execute with approval | **Selected** |
| Clean condenser tubes on the lag chiller | −1,800 | −504.00 | Energy target (3) | execute with approval | Ranked below |
| **Drop building-wide chilled-water setpoint to 6.0 °C** | **+2,295** | **+642.60** | Energy target (3) | recommend | **Rejected** |
| Night purge via AHU economiser cycle | −900 | −252.00 | Preference (4) | recommend | Ranked below |

Selection rule (`pickRecommended`): rank by `policyRank` ascending, then by `sgdDelta` ascending, and
take the first option that does **not** increase cost. The setpoint drop is ranked *below* the
condenser cleaning within tier 3 because it costs more, and it is rejected outright because it is a
cost-increasing option at or above the energy-target tier.

The card states this in policy terms rather than hiding it:

> Recommended 'Re-sequence chiller staging (lead/lag rotation)' (policy tier 2): SGD 1285.20 saving.
> Rejected 'Drop building-wide chilled-water setpoint to 6.0 °C': it breaches the energy-target policy
> tier and would raise cost by SGD 642.60.

**This is the point of the whole product.** The instinctive fix over-cools every floor and *raises*
energy spend by S$642.60. The pill prices it, shows it, and refuses it — with a reason an operator can
argue with.

## What the card also shows

- Every claim on the pill cites a **verbatim transcript excerpt**; `GET /api/pills/pill-0001` returns
  the claim, its `kind`, its `confidence`, and the `sourceExcerptId` it rests on. The one `unknown`
  claim ("whether the condenser tubes are fouled this quarter is unverified") carries confidence 0
  and no excerpt, which is what FR-02 requires.
- `modelAssisted: false` — proving the model is optional, not load-bearing.
- `auditVerified: true` — the chain still verifies after the run.

## The three exits (all tested)

| Case | Trigger | Route | Observable |
|---|---|---|---|
| **Escalate** | *"There is smoke coming from the AHU on level 23"* | `escalate` | severity `safety`, handoff *Fire Safety Officer + Chief Engineer*, `selection: null`, `metrics: null`, hops stop at `escalate` |
| **Blocked** | The Tower K pill applied at Harbourfront One, floor 5 | `blocked` | mismatches `chiller_plant` (CP-1 vs CP-2), `tariff` (0.280 vs 0.310), `gfa_sqm` (≥30,000 vs 28,000) |
| **No match** | A complaint no approved pill is relevant to | `recommend` | `selection: null`, no options priced, a direct answer rather than a guess |

## The governance loop

1. The chief engineer captures a pill. Every non-`unknown` claim must cite a quote that **actually
   appears** in the submitted transcript, or the capture is rejected (FR-02).
2. He submits it for review. He cannot approve it himself — even if his role permitted review, the
   service rejects the author as approver (FR-03).
3. A pill reviewer approves it. Only now does it become retrievable; retrieval serves **approved
   versions only**, so the seeded draft pill (`vav-box-reheat-valve-calibration`) never appears on a
   card.
4. The owner revises it. Version n+1 is created as a **draft** and the live version is untouched.
5. A regression is found and the reviewer rolls back. The target version is re-activated and the
   current one becomes `superseded` — history is never rewritten.

## Reproduce it

```bash
# unit + integration level, no server, no database
cd backend && npx vitest run src/__tests__/cases.test.ts

# with the stack running
cd backend && npm run dev
curl -s -X POST http://localhost:8000/api/cases \
  -H "content-type: application/json" -H "x-harvest-role: aom" \
  -d '{"siteId":"site-towerk","floor":23,"zone":"North","symptom":"Level 23 is too hot and stuffy at 14:40","description":"Tenant reports 26.5 C against a target of 23 C. Building-wide chiller plant efficiency has drifted from 0.62 to 0.71 kW/RT over the past two weeks."}'
```
