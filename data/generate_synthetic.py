#!/usr/bin/env python
"""
HARVEST — deterministic synthetic data generator.

Produces, from a fixed RNG seed (so every run is byte-identical):

    data/raw/chiller_timeseries.csv   14 days x 15-min chiller readings, kW/RT drifting 0.62 -> 0.71
    data/seed_tower.json              site, assets, tenants and the hero-case payload
    data/seed_pills.json              the approved Energy pill (+ historical/proposed versions)
    data/seed.sql                     INSERTs for users, roles, tenants, excerpts, pills

ALL DATA IS SYNTHETIC. No real Keppel or personal data.

Usage:
    python data/generate_synthetic.py
"""

from __future__ import annotations

import csv
import json
import math
import random
from datetime import datetime, timedelta, timezone
from pathlib import Path

DATA_DIR = Path(__file__).resolve().parent
RAW_DIR = DATA_DIR / "raw"
SEED = 20261002  # fixed — do not change without regenerating seed.sql

SGT = timezone(timedelta(hours=8))

# ---------------------------------------------------------------- users / roles
USERS = [
    ("11111111-1111-1111-1111-111111111111", "aom@harvest.demo", "Aisha Rahman", "aom", "SGT-01"),
    ("22222222-2222-2222-2222-222222222222", "chief@harvest.demo", "Lim Wei Ming", "chief_engineer", "SGT-01"),
    ("33333333-3333-3333-3333-333333333333", "reviewer@harvest.demo", "Priya Nair", "pill_reviewer", None),
    ("44444444-4444-4444-4444-444444444444", "operator@harvest.demo", "Faizal bin Osman", "site_operator", "SGT-01"),
    ("55555555-5555-5555-5555-555555555555", "gov@harvest.demo", "Grace Tan", "governance_admin", None),
]
AOM_ID, CHIEF_ID, REVIEWER_ID, OPERATOR_ID, GOV_ID = (u[0] for u in USERS)

# ---------------------------------------------------------------- sites
SITES = [
    {
        "site_id": "SGT-01",
        "name": "Tower K",
        "asset_type": "office",
        "chiller_plant": "water_cooled_3x",
        "tariff": "SG_commercial",
        "floors": 30,
        "role": "hero",
    },
    {
        "site_id": "SGT-02",
        "name": "Tower B",
        "asset_type": "office",
        "chiller_plant": "air_cooled_2x",  # different plant -> transfer must be blocked
        "tariff": "SG_commercial",
        "floors": 18,
        "role": "transfer_test",
    },
]

# ---------------------------------------------------------------- tenants (12)
TENANT_LEVELS = [3, 5, 7, 9, 11, 13, 15, 17, 19, 21, 23, 25]
TENANT_NAMES = [
    "Orion Legal", "Meridian Bank", "Kestrel Analytics", "Juniper Health",
    "Northwind Shipping", "Vantage Capital", "Selat Logistics", "Banyan Studios",
    "Cobalt Fintech", "Harbourline Media", "ACME Manufacturing", "Straits Advisory",
]
HERO_TENANT_LEVEL = 23  # ACME Manufacturing

# ---------------------------------------------------------------- transcript excerpts
EXCERPTS = [
    ("ex-1", "int-001", "Mr Lim",
     "The first thing I ask is: is it one zone or many? That single question decides everything else."),
    ("ex-2", "int-001", "Mr Lim",
     "If it is one zone, the plant is usually fine. The problem is downstream — a VAV box, a damper, "
     "a sensor that has drifted."),
    ("ex-3", "int-001", "Mr Lim",
     "People get excited when they see kW/RT climb. But it climbs every afternoon in September. "
     "You have to look at the trend over two weeks, not one bad hour."),
    ("ex-4", "int-001", "Mr Lim",
     "When one floor complains, I look at that floor, not the plant. Nine times out of ten it is a "
     "damper stuck low — the air is there, it just is not reaching the zone."),
    ("ex-5", "int-001", "Mr Lim",
     "The day after a public holiday the building starts warm because nobody pre-cooled it. "
     "That is not a fault. Do not chase it."),
    ("ex-6", "int-001", "Mr Lim",
     "If it is many zones on different facades at the same time, now I look at the plant. "
     "That is when re-sequencing the chillers earns its keep."),
    ("ex-7", "int-001", "Mr Lim",
     "The mistake I see young engineers make is dropping the whole building setpoint to fix one hot "
     "floor. You cool three hundred other zones to fix one. I never do that."),
    ("ex-8", "int-001", "Mr Lim",
     "Odour, illness, or anything from the cooling tower — that never goes through me. It goes "
     "straight to the duty engineer. Comfort can wait; safety cannot."),
    ("ex-9", "int-001", "Mr Lim",
     "I could not tell you the exact tariff band we were on last quarter. I leave the money side to "
     "the managers; I just keep the building comfortable and the plant honest."),
]

# ---------------------------------------------------------------- the pill
PILL_ID = "pill-energy-chiller-drift"

CONTEXT = {"asset_type": "office", "chiller_plant": "water_cooled_3x", "tariff": "SG_commercial"}

DECISION_LOGIC = {
    "design_kwrt": 0.60,
    "baseline_kwrt": 0.62,
    "drift_threshold": 0.05,
    "energy_price_sgd_per_kwh": 0.28,
    "comfort_band_c": [23.0, 25.0],
    "horizon_hours": 24,
    "load_rt": 850.0,
    # fraction of excess plant energy each lever recovers (deterministic, code-owned)
    "lever_recovery": {
        "opt-inspect-vav": 0.0,
        "opt-resequence-chillers": 0.70,
        "opt-setpoint-drop": -0.35,  # negative = wastes energy
    },
}

TRIGGERS = ["Comfort complaint while kW/RT is above baseline", "Single-zone hot complaint"]
CRITICAL_CUES = [
    "Repeat complaints from one zone",
    "One VAV damper stuck low",
    "kW/RT drift sustained over 10+ days",
]
DISCOUNTED_SIGNALS = [
    "One warm afternoon after a public holiday start-up",
    "Single afternoon spike in kW/RT during September",
]
NEVER_DO = [
    "Never lower the building-wide setpoint for a single-zone complaint",
    "Never re-sequence chillers without approval",
]
TRADE_OFFS = {
    "opt-inspect-vav": "Low effort, no plant energy impact; fixes comfort only.",
    "opt-resequence-chillers": "Recovers plant efficiency; needs an approved band and a short load shift.",
    "opt-setpoint-drop": "Fixes the zone but raises plant kWh across every other zone.",
}
ESCALATION = {
    "safety": "Odour, illness, or any cooling-tower result above limit -> duty engineer before any LLM call.",
    "out_of_band_setpoint": "Any setpoint outside the approved band -> escalate.",
}

# version -> (status, eval_status, eval_score, governance note)
VERSIONS = {
    1: ("superseded", "passed", 0.8800, "Initial capture from int-001."),
    2: ("approved", "passed", 0.9200, "Tightened damper-first wording after review."),
    3: ("draft", "failed", 0.7100, "Proposed: allow +0.5C during peak tariff hours. FAILED one comfort case."),
}
CURRENT_VERSION = 2

# (option_id, tier, label, detail, source_excerpt_id)
OPTIONS_V2 = [
    ("opt-inspect-vav", "recommend", "Inspect the L23 VAV damper and zone sensor",
     "Check the zone air path first; no plant change and no energy cost.", "ex-4"),
    ("opt-resequence-chillers", "execute_with_approval", "Re-sequence chillers within the approved band",
     "Recovers plant efficiency once drift exceeds the threshold; needs AOM approval.", "ex-6"),
    ("opt-setpoint-drop", "escalate", "Lower the building-wide setpoint",
     "Never for a single-zone complaint: fixes one zone and raises plant kWh everywhere else.", "ex-7"),
]
OPTIONS_V1 = [
    ("opt-inspect-vav", "recommend", "Check the L23 zone air path",
     "First check of the zone air path before any plant action.", "ex-4"),
    ("opt-resequence-chillers", "execute_with_approval", "Re-sequence chillers",
     "Re-sequence the plant once drift is confirmed.", "ex-6"),
    ("opt-setpoint-drop", "escalate", "Lower the building-wide setpoint",
     "Building-wide setpoint change for a single zone is never approved.", "ex-7"),
]
OPTIONS_V3 = [
    ("opt-inspect-vav", "recommend", "Inspect the L23 VAV damper and zone sensor",
     "Check the zone air path first; no plant change and no energy cost.", "ex-4"),
    ("opt-raise-setpoint", "execute_with_approval", "Raise the zone setpoint +0.5C during peak tariff hours",
     "Proposed relaxation during peak tariff; FAILED the comfort eval case.", "ex-7"),
]

CLAIMS_V2 = [
    ("fact", "A single-zone complaint is usually downstream of the plant, not caused by it.", "ex-1", 0.95),
    ("fact", "A sustained kW/RT rise over two weeks is drift; a single warm afternoon is not.", "ex-3", 0.90),
    ("interpretation", "A damper stuck low explains one hot floor while the plant still runs.", "ex-4", 0.85),
    ("action", "Inspect the L23 VAV damper before touching any plant setpoint.", "ex-4", 0.92),
    ("action", "Re-sequence chillers only when drift exceeds the threshold and multiple zones are affected.", "ex-6", 0.88),
    ("unknown", "The exact lease comfort band Keppel green leases specify.", None, None),
]
CLAIMS_V1 = [
    ("fact", "A single-zone complaint is usually downstream of the plant.", "ex-1", 0.90),
    ("action", "Check the L23 zone air path before touching the plant.", "ex-4", 0.88),
]
CLAIMS_V3 = [
    ("fact", "Peak tariff hours are the expensive window for plant energy.", "ex-9", 0.60),
    ("action", "Raise the zone setpoint +0.5C during peak tariff hours.", "ex-7", 0.55),
]


# ---------------------------------------------------------------- helpers
def _sql_str(value: str | None) -> str:
    if value is None:
        return "NULL"
    return "'" + value.replace("'", "''") + "'"


def _sql_json(value: object) -> str:
    return _sql_str(json.dumps(value, ensure_ascii=False, sort_keys=True)) + "::jsonb"


def _sql_bool(value: bool) -> str:
    return "true" if value else "false"


# ---------------------------------------------------------------- chiller series
def build_chiller_series() -> list[dict]:
    """14 days x 15-min readings. Mean kW/RT drifts 0.62 -> 0.71 across the window."""
    rng = random.Random(SEED)
    start = datetime(2026, 9, 19, 0, 0, tzinfo=SGT)
    days, per_day = 14, 96
    rows: list[dict] = []

    for i in range(days * per_day):
        ts = start + timedelta(minutes=15 * i)
        day_frac = i / (days * per_day - 1)
        hour = ts.hour + ts.minute / 60.0

        # deterministic drift, plus a daily occupancy/weather shape and small noise
        drift = 0.62 + 0.09 * day_frac
        occupancy = 1.0 + 0.06 * math.sin((hour - 8) / 24 * 2 * math.pi)
        noise = rng.gauss(0, 0.004)
        kwrt = round(max(0.55, drift * occupancy + noise), 4)

        load_rt = round(
            520 + 330 * max(0.0, math.sin((hour - 6) / 12 * math.pi)) + rng.gauss(0, 12), 1
        )
        load_rt = max(180.0, load_rt)
        wet_bulb = round(25.5 + 1.8 * math.sin((hour - 9) / 24 * 2 * math.pi) + rng.gauss(0, 0.3), 2)
        chw_supply = round(6.8 + 0.5 * day_frac + rng.gauss(0, 0.08), 2)
        cw_return = round(32.0 + 1.2 * day_frac + rng.gauss(0, 0.2), 2)

        rows.append(
            {
                "timestamp": ts.isoformat(),
                "chiller_kw": round(kwrt * load_rt, 2),
                "cooling_load_rt": load_rt,
                "kwrt": kwrt,
                "wet_bulb_c": wet_bulb,
                "chilled_water_supply_c": chw_supply,
                "condenser_water_return_c": cw_return,
            }
        )
    return rows


def write_csv(rows: list[dict]) -> None:
    RAW_DIR.mkdir(parents=True, exist_ok=True)
    path = RAW_DIR / "chiller_timeseries.csv"
    with path.open("w", newline="", encoding="utf-8") as fh:
        writer = csv.DictWriter(fh, fieldnames=list(rows[0].keys()))
        writer.writeheader()
        writer.writerows(rows)


# ---------------------------------------------------------------- JSON seeds
def build_tower_json(rows: list[dict]) -> dict:
    first_day = [r["kwrt"] for r in rows[:96]]
    last_day = [r["kwrt"] for r in rows[-96:]]
    return {
        "_notice": "SYNTHETIC DATA — generated by data/generate_synthetic.py (seed=%d)" % SEED,
        "sites": SITES,
        "tenants": [
            {
                "id": f"L{level:02d}-{TENANT_NAMES[idx].split()[0].upper()[:5]}",
                "level": level,
                "name": TENANT_NAMES[idx],
                "lease_comfort_min_c": 23.0,
                "lease_comfort_max_c": 25.0,
                "renewal_due": "2026-11-15" if level == HERO_TENANT_LEVEL else "2027-06-30",
            }
            for idx, level in enumerate(TENANT_LEVELS)
        ],
        "chiller_summary": {
            "window_days": 14,
            "intervals_per_day": 96,
            "first_day_mean_kwrt": round(sum(first_day) / len(first_day), 4),
            "last_day_mean_kwrt": round(sum(last_day) / len(last_day), 4),
            "csv": "data/raw/chiller_timeseries.csv",
        },
        "hero_case": {
            "site_id": "SGT-01",
            "asset_type": "office",
            "chiller_plant": "water_cooled_3x",
            "tariff": "SG_commercial",
            "tenant_id": f"L{HERO_TENANT_LEVEL}-ACME",
            "level": HERO_TENANT_LEVEL,
            "reported_at": "2026-10-02T14:40:00+08:00",
            "complaint_text": "Level 23 ACME — it's too hot in our meeting rooms this afternoon.",
            # derived from the generated series so the story numbers match the CSV
            "baseline_kwrt": round(sum(first_day) / len(first_day), 2),
            "current_kwrt": round(sum(last_day) / len(last_day), 2),
        },
    }


def build_pills_json() -> dict:
    def version_block(v: int, options: list, claims: list) -> dict:
        status, eval_status, eval_score, note = VERSIONS[v]
        return {
            "version": v,
            "status": status,
            "eval_status": eval_status,
            "eval_score": eval_score,
            "governance_note": note,
            "options": [
                {"id": oid, "tier": tier, "label": label, "detail": detail, "source_excerpt_id": src}
                for oid, tier, label, detail, src in options
            ],
            "claims": [
                {"kind": kind, "text": text, "source_excerpt_id": src, "confidence": conf}
                for kind, text, src, conf in claims
            ],
        }

    return {
        "_notice": "SYNTHETIC DATA — generated by data/generate_synthetic.py (seed=%d)" % SEED,
        "pills": [
            {
                "id": PILL_ID,
                "domain": "energy",
                "layer": "site",
                "title": "Zone complaint during plant drift",
                "owner_id": CHIEF_ID,
                "reviewer_id": REVIEWER_ID,
                "status": "approved",
                "current_version": CURRENT_VERSION,
                "access_class": "internal",
                "context": CONTEXT,
                "triggers": TRIGGERS,
                "critical_cues": CRITICAL_CUES,
                "discounted_signals": DISCOUNTED_SIGNALS,
                "never_do": NEVER_DO,
                "trade_offs": TRADE_OFFS,
                "escalation": ESCALATION,
                "decision_logic": DECISION_LOGIC,
                "versions": [
                    version_block(1, OPTIONS_V1, CLAIMS_V1),
                    version_block(2, OPTIONS_V2, CLAIMS_V2),
                    version_block(3, OPTIONS_V3, CLAIMS_V3),
                ],
            }
        ],
    }


# ---------------------------------------------------------------- seed.sql
def build_seed_sql() -> str:
    out: list[str] = [
        "-- =============================================================",
        "-- HARVEST — synthetic seed data. GENERATED FILE — do not edit by hand.",
        f"-- Source: data/generate_synthetic.py  (seed={SEED})",
        "-- ALL DATA IS SYNTHETIC.",
        "-- =============================================================",
        "",
        "BEGIN;",
        "",
        "-- users",
    ]

    for uid, email, name, _role, _site in USERS:
        out.append(
            f"INSERT INTO app_users (id, email, display_name) VALUES "
            f"({_sql_str(uid)}, {_sql_str(email)}, {_sql_str(name)}) ON CONFLICT DO NOTHING;"
        )

    out += ["", "-- roles"]
    for uid, _email, _name, role, site in USERS:
        out.append(
            f"INSERT INTO user_roles (user_id, role, site_id) VALUES "
            f"({_sql_str(uid)}, {_sql_str(role)}::role_name, {_sql_str(site)}) ON CONFLICT DO NOTHING;"
        )

    out += ["", "-- tenants (read-only renewal signal)"]
    for idx, level in enumerate(TENANT_LEVELS):
        tid = f"L{level:02d}-{TENANT_NAMES[idx].split()[0].upper()[:5]}"
        renewal = "2026-11-15" if level == HERO_TENANT_LEVEL else "2027-06-30"
        out.append(
            f"INSERT INTO tenants (id, level, name, lease_comfort_min_c, lease_comfort_max_c, renewal_due) "
            f"VALUES ({_sql_str(tid)}, {level}, {_sql_str(TENANT_NAMES[idx])}, 23.0, 25.0, DATE {_sql_str(renewal)}) "
            f"ON CONFLICT DO NOTHING;"
        )

    out += ["", "-- transcript excerpts"]
    base = datetime(2026, 9, 12, 10, 0, tzinfo=SGT)
    for i, (eid, iid, speaker, text) in enumerate(EXCERPTS):
        ts = (base + timedelta(minutes=6 * i)).isoformat()
        out.append(
            f"INSERT INTO transcript_excerpts (id, interview_id, speaker, occurred_at, text) VALUES "
            f"({_sql_str(eid)}, {_sql_str(iid)}, {_sql_str(speaker)}, {_sql_str(ts)}::timestamptz, {_sql_str(text)}) "
            f"ON CONFLICT DO NOTHING;"
        )

    out += ["", "-- pill"]
    out.append(
        "INSERT INTO pills (id, domain, layer, title, owner_id, reviewer_id, status, current_version, access_class) VALUES "
        f"({_sql_str(PILL_ID)}, 'energy'::pill_domain, 'site', "
        f"{_sql_str('Zone complaint during plant drift')}, {_sql_str(CHIEF_ID)}, {_sql_str(REVIEWER_ID)}, "
        f"'approved'::pill_status, {CURRENT_VERSION}, 'internal') ON CONFLICT DO NOTHING;"
    )

    out += ["", "-- pill versions"]
    for v in (1, 2, 3):
        status, eval_status, eval_score, note = VERSIONS[v]
        out.append(
            "INSERT INTO pill_versions (pill_id, version, status, context, triggers, critical_cues, "
            "discounted_signals, decision_logic, never_do, trade_offs, escalation, governance, "
            "eval_status, eval_score, created_by) VALUES ("
            f"{_sql_str(PILL_ID)}, {v}, {_sql_str(status)}::pill_status, "
            f"{_sql_json(CONTEXT)}, {_sql_json(TRIGGERS)}, "
            f"{_sql_json(CRITICAL_CUES)}, {_sql_json(DISCOUNTED_SIGNALS)}, {_sql_json(DECISION_LOGIC)}, "
            f"{_sql_json(NEVER_DO)}, {_sql_json(TRADE_OFFS)}, {_sql_json(ESCALATION)}, "
            f"{_sql_json({'note': note, 'owner': 'Lim Wei Ming', 'reviewer': 'Priya Nair'})}, "
            f"{_sql_str(eval_status)}, {eval_score}, {_sql_str(CHIEF_ID)}) ON CONFLICT DO NOTHING;"
        )

    out += ["", "-- claims (FR-02: non-unknown claims must carry a source excerpt)"]
    for v, claims in ((1, CLAIMS_V1), (2, CLAIMS_V2), (3, CLAIMS_V3)):
        for kind, text, src, conf in claims:
            conf_sql = "NULL" if conf is None else f"{conf}"
            out.append(
                "INSERT INTO claims (pill_id, version, kind, text, source_excerpt_id, confidence) VALUES ("
                f"{_sql_str(PILL_ID)}, {v}, {_sql_str(kind)}::claim_kind, {_sql_str(text)}, "
                f"{_sql_str(src)}, {conf_sql});"
            )

    out += ["", "-- pill options (expected_kwh_delta left NULL: kWh is computed by analytics.py, never stored)"]
    for v, options in ((1, OPTIONS_V1), (2, OPTIONS_V2), (3, OPTIONS_V3)):
        for oid, tier, label, detail, src in options:
            comfort = (
                "zone fixed; whole-tower plant kWh rises" if tier == "escalate" else "comfort restored in zone"
            )
            out.append(
                "INSERT INTO pill_options (id, pill_id, version, label, tier, detail, "
                "expected_kwh_delta, comfort_impact, source_excerpt_id) VALUES ("
                f"{_sql_str(oid)}, {_sql_str(PILL_ID)}, {v}, {_sql_str(label)}, "
                f"{_sql_str(tier)}::action_tier, {_sql_str(detail)}, NULL, {_sql_str(comfort)}, "
                f"{_sql_str(src)}) ON CONFLICT DO NOTHING;"
            )

    out += ["", "COMMIT;", ""]
    return "\n".join(out)


def main() -> None:
    rows = build_chiller_series()
    write_csv(rows)

    (DATA_DIR / "seed_tower.json").write_text(
        json.dumps(build_tower_json(rows), indent=2, ensure_ascii=False), encoding="utf-8"
    )
    (DATA_DIR / "seed_pills.json").write_text(
        json.dumps(build_pills_json(), indent=2, ensure_ascii=False), encoding="utf-8"
    )
    (DATA_DIR / "seed.sql").write_text(build_seed_sql(), encoding="utf-8")

    first = sum(r["kwrt"] for r in rows[:96]) / 96
    last = sum(r["kwrt"] for r in rows[-96:]) / 96
    print(f"wrote {len(rows)} chiller readings  (day-1 mean {first:.4f} -> day-14 mean {last:.4f} kW/RT)")
    print("wrote data/seed_tower.json, data/seed_pills.json, data/seed.sql")


if __name__ == "__main__":
    main()
