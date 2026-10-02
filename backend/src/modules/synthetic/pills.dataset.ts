/**
 * The seeded pill library.
 *
 * These are authored as capture interviews and then run through the real governance path
 * (`capturePill` → `submitForReview` → `approvePill`) by the seed. Nothing is inserted
 * directly as "approved", so the seeded state is reachable only through the same rules a human
 * would face — including FR-02 provenance and FR-03 separation of duties.
 *
 * Every `sourceQuote` below is a verbatim substring of a transcript line in the same entry.
 * `validateClaims` enforces that, so a careless edit here fails the seed rather than silently
 * producing an unsourced pill.
 */

import { POLICY_TIERS } from "@/modules/pills/pill.types";
import type { PillCaptureInput } from "@/modules/pills/pill.types";

export interface PillSeedEntry {
  /**
   * The slug `slugify(title)` must produce. `runSeed` asserts this, and the eval ticket set
   * references pills by slug — so a title edit that changes the slug fails the seed loudly
   * instead of quietly breaking retrieval evaluation.
   */
  slug: string;
  /** When false the pill stays a draft and must not be retrievable. */
  publish: boolean;
  reviewNote?: string;
  input: PillCaptureInput;
}

const CHILLER_STAGING: PillSeedEntry = {
  slug: "chiller-plant-staging-drift",
  publish: true,
  reviewNote:
    "Metrics reproduce from the 14-day telemetry. Options are priced and the setpoint option is correctly demoted.",
  input: {
    title: "Chiller Plant Staging Drift",
    domain: "chiller_plant",
    summary:
      "Restore the lead/lag staging sequence when plant efficiency drifts upward, before touching any space setpoint.",
    triggers: [
      "chiller plant efficiency drift",
      "kw per rt rising",
      "staging sequence wrong",
      "lead lag rotation",
      "chiller sequencing",
      "plant efficiency degradation",
      "chiller drift",
      "too hot",
      "level 23",
      "stuffy",
    ],
    steps: [
      "Confirm the drift against the 14-day kW/RT trend, not a single reading.",
      "Check whether the staging sequence was left on manual after a service.",
      "Re-sequence the lead/lag rotation and confirm the lag chiller is loading.",
      "Re-measure kW/RT after two full load cycles before closing the case.",
      "Do not lower the building-wide chilled-water setpoint to mask the drift.",
    ],
    actionTier: "execute_with_approval",
    contextRequirements: {
      assetTypes: ["chiller_plant", "ahu"],
      chillerPlant: "CP-1",
      tariffSgdPerKwh: 0.28,
      minGfaSqm: 30000,
    },
    claims: [
      {
        kind: "measured",
        text: "Plant efficiency drifted from 0.6230 to 0.7130 kW/RT over 14 days.",
        sourceQuote:
          "efficiency has gone from 0.6230 to 0.7130 kW per RT over the last fourteen days",
        confidence: 0.97,
      },
      {
        kind: "derived",
        text: "Re-sequencing the staging order recovers about 4590 kWh per day.",
        sourceQuote: "Re-sequencing the staging order recovers about 4590 kilowatt hours a day",
        confidence: 0.8,
      },
      {
        kind: "measured",
        text: "Excess demand measured at 76.5 kW at 850 RT load.",
        sourceQuote: "We measured 76.5 kilowatts of excess demand at 850 RT load",
        confidence: 0.95,
      },
      {
        kind: "unknown",
        text: "Whether the condenser tubes are also fouled this quarter is unverified.",
        sourceQuote: null,
      },
    ],
    options: [
      {
        label: "Re-sequence chiller staging (lead/lag rotation)",
        detail:
          "Restores the intended staging order. Recovers the drift without changing any space condition, so comfort is untouched.",
        actionTier: "execute_with_approval",
        sgdDelta: -1285.2,
        policyRank: POLICY_TIERS.lease_comfort,
        sourceQuote: "Re-sequencing the staging order recovers about 4590 kilowatt hours a day",
      },
      {
        label: "Clean condenser tubes on the lag chiller",
        detail:
          "Fouling is the likely root cause. Cleaning is the durable fix and is scheduled with the next plant shutdown.",
        actionTier: "execute_with_approval",
        sgdDelta: -504,
        policyRank: POLICY_TIERS.energy_target,
        sourceQuote: null,
      },
      {
        label: "Drop building-wide chilled-water setpoint to 6.0 °C",
        detail:
          "Masks the symptom by over-cooling every floor, raises energy cost, and breaches the energy-target policy tier. Shown so the trade-off is visible, not because it is viable.",
        actionTier: "recommend",
        sgdDelta: 642.6,
        policyRank: POLICY_TIERS.energy_target,
        sourceQuote: null,
      },
      {
        label: "Night purge via AHU economiser cycle",
        detail: "Comfort-neutral pre-cooling between 01:00 and 05:00 using outside air.",
        actionTier: "recommend",
        sgdDelta: -252,
        policyRank: POLICY_TIERS.preference,
        sourceQuote: null,
      },
    ],
    transcript: [
      {
        speaker: "Daniel Tan",
        text: "The Tower K chiller plant efficiency has gone from 0.6230 to 0.7130 kW per RT over the last fourteen days.",
      },
      {
        speaker: "Daniel Tan",
        text: "The lead chiller is carrying the base load because the staging sequence was left on manual after the September service.",
      },
      {
        speaker: "Daniel Tan",
        text: "Re-sequencing the staging order recovers about 4590 kilowatt hours a day without touching the space setpoint.",
      },
      {
        speaker: "Daniel Tan",
        text: "We measured 76.5 kilowatts of excess demand at 850 RT load.",
      },
      {
        speaker: "Daniel Tan",
        text: "I am not certain whether the condenser tubes are fouled as well, we have not pulled the heads this quarter.",
      },
    ],
  },
};

const AHU_NIGHT_PURGE: PillSeedEntry = {
  slug: "ahu-night-purge-and-economiser-cycle",
  publish: true,
  reviewNote: "Procedure is comfort-neutral and reversible. Approved.",
  input: {
    title: "AHU Night Purge And Economiser Cycle",
    domain: "ahu",
    summary:
      "Use outside air overnight when the economiser damper is serviceable, to pre-cool the slab without chilled water.",
    triggers: [
      "stale air",
      "night purge",
      "economiser damper",
      "fresh air damper stuck",
      "ahu ventilation",
      "co2 level high",
    ],
    steps: [
      "Confirm the economiser damper actuator is not stuck before scheduling a purge.",
      "Schedule the purge between 01:00 and 05:00, outside lease hours.",
      "Verify the damper returns to its scheduled position by 07:00.",
    ],
    actionTier: "execute_with_approval",
    contextRequirements: {
      assetTypes: ["ahu"],
      chillerPlant: "CP-1",
      tariffSgdPerKwh: null,
      minGfaSqm: null,
    },
    claims: [
      {
        kind: "measured",
        text: "The economiser damper has been stuck closed since the actuator failed.",
        sourceQuote: "AHU economiser damper has been stuck closed since the damper actuator failed",
        confidence: 0.9,
      },
      {
        kind: "derived",
        text: "A night purge avoids about 900 kWh of cooling load per day.",
        sourceQuote: "about 900 kilowatt hours a day of avoidable cooling load",
        confidence: 0.7,
      },
      {
        kind: "unknown",
        text: "Whether the actuator failure affected other AHUs on the same riser is unverified.",
        sourceQuote: null,
      },
    ],
    options: [
      {
        label: "Enable night purge via AHU economiser 01:00-05:00",
        detail: "Comfort-neutral, reversible, and requires no plant change.",
        actionTier: "execute_with_approval",
        sgdDelta: -252,
        policyRank: POLICY_TIERS.preference,
        sourceQuote: null,
      },
    ],
    transcript: [
      {
        speaker: "Daniel Tan",
        text: "The level 12 AHU economiser damper has been stuck closed since the damper actuator failed.",
      },
      {
        speaker: "Daniel Tan",
        text: "Running a night purge between one and five in the morning uses outside air instead of chilled water.",
      },
      {
        speaker: "Daniel Tan",
        text: "We measured about 900 kilowatt hours a day of avoidable cooling load.",
      },
    ],
  },
};

const TENANT_COMFORT_BAND: PillSeedEntry = {
  slug: "tenant-comfort-band-review",
  publish: true,
  reviewNote: "Correctly defers to the lease terms rather than to an energy target.",
  input: {
    title: "Tenant Comfort Band Review",
    domain: "tenant_zone",
    summary:
      "Resolve overcooling complaints against the contractual lease comfort band before changing any plant setting.",
    triggers: [
      "overcooling",
      "too cold",
      "lease comfort band",
      "tenant too cold",
      "comfort complaint cold",
    ],
    steps: [
      "Read the lease comfort band and leased hours for the tenant.",
      "Compare the measured zone temperature against the band, inside lease hours only.",
      "If the zone is inside the band, the complaint is a preference, not a defect.",
    ],
    actionTier: "recommend",
    contextRequirements: {
      assetTypes: ["tenant_zone", "ahu"],
      chillerPlant: "CP-1",
      tariffSgdPerKwh: null,
      minGfaSqm: null,
    },
    claims: [
      {
        kind: "measured",
        text: "The lease specifies a comfort band of 22.5–24.5 °C during Mon-Fri 08:00-19:00.",
        sourceQuote: "lease specifies 22.5 to 24.5 degrees during Mon-Fri 08:00 to 19:00",
        confidence: 0.99,
      },
      {
        kind: "assumed",
        text: "The overcooling is caused by a fixed setpoint rather than by tenant internal load.",
        sourceQuote: "reports the space is too cold against their lease comfort band",
        confidence: 0.4,
      },
    ],
    options: [
      {
        label: "Review the lease comfort band with the tenant",
        detail:
          "Lease terms outrank energy targets in the policy hierarchy. No plant change until the band is agreed.",
        actionTier: "recommend",
        sgdDelta: 0,
        policyRank: POLICY_TIERS.lease_comfort,
        sourceQuote: null,
      },
    ],
    transcript: [
      {
        speaker: "Daniel Tan",
        text: "The tenant on level 21 reports the space is too cold against their lease comfort band.",
      },
      {
        speaker: "Daniel Tan",
        text: "Their lease specifies 22.5 to 24.5 degrees during Mon-Fri 08:00 to 19:00.",
      },
    ],
  },
};

const CONDENSER_FOULING: PillSeedEntry = {
  slug: "chiller-condenser-tube-fouling",
  publish: true,
  reviewNote: "Distinct from the staging pill; triggers do not overlap materially.",
  input: {
    title: "Chiller Condenser Tube Fouling",
    domain: "chiller_plant",
    summary:
      "Diagnose a rising condenser approach temperature and clean the tubes when fouling is confirmed.",
    triggers: [
      "condenser approach temperature",
      "condenser tube fouling",
      "condenser water delta t",
      "tube cleaning",
      "condenser fouling",
    ],
    steps: [
      "Trend the condenser approach temperature against the commissioning baseline.",
      "Confirm with a water-side delta-T check before booking a shutdown.",
      "Clean the tubes and re-baseline the approach temperature afterwards.",
    ],
    actionTier: "execute_with_approval",
    contextRequirements: {
      assetTypes: ["chiller_plant"],
      chillerPlant: "CP-1",
      tariffSgdPerKwh: null,
      minGfaSqm: null,
    },
    claims: [
      {
        kind: "measured",
        text: "Condenser approach temperature rose about 2 °C over the quarter.",
        sourceQuote: "condenser approach temperature on the lag chiller has risen by about two degrees",
        confidence: 0.85,
      },
      {
        kind: "assumed",
        text: "Tube fouling is the likely cause of the approach rise.",
        sourceQuote: "fouling is the working assumption",
        confidence: 0.6,
      },
    ],
    options: [
      {
        label: "Clean condenser tubes on the lag chiller",
        detail: "Restores the approach temperature and recovers the associated lift penalty.",
        actionTier: "execute_with_approval",
        sgdDelta: -504,
        policyRank: POLICY_TIERS.energy_target,
        sourceQuote: null,
      },
    ],
    transcript: [
      {
        speaker: "Daniel Tan",
        text: "The condenser approach temperature on the lag chiller has risen by about two degrees over the quarter.",
      },
      {
        speaker: "Daniel Tan",
        text: "We have not pulled the condenser heads this quarter, so fouling is the working assumption.",
      },
    ],
  },
};

const WATER_HYGIENE: PillSeedEntry = {
  slug: "cooling-tower-water-hygiene-routine",
  publish: true,
  reviewNote: "Statutory tier. Must outrank every energy consideration.",
  input: {
    title: "Cooling Tower Water Hygiene Routine",
    domain: "cooling_tower",
    summary:
      "Restore biocide dosing and blowdown discipline on the cooling tower water circuit.",
    triggers: [
      "cooling tower water treatment",
      "conductivity high",
      "blowdown schedule",
      "biocide dosing",
      "water hygiene routine",
    ],
    steps: [
      "Restore the biocide dosing schedule to the statutory interval.",
      "Bring blowdown control back within the conductivity setpoint.",
      "Book an independent water test before returning the tower to normal service.",
    ],
    actionTier: "execute_with_approval",
    contextRequirements: {
      assetTypes: ["cooling_tower"],
      chillerPlant: "CP-1",
      tariffSgdPerKwh: null,
      minGfaSqm: null,
    },
    claims: [
      {
        kind: "measured",
        text: "Cooling tower conductivity is running above the control setpoint.",
        sourceQuote: "cooling tower conductivity has been running high",
        confidence: 0.9,
      },
      {
        kind: "derived",
        text: "The blowdown schedule has slipped behind the required interval.",
        sourceQuote: "the blowdown schedule has slipped",
        confidence: 0.85,
      },
      {
        kind: "unknown",
        text: "Whether the last independent water test returned a positive result is unverified.",
        sourceQuote: null,
      },
    ],
    options: [
      {
        label: "Restore biocide dosing and blowdown schedule",
        detail:
          "Statutory water-hygiene obligation. Outranks every energy target in the policy hierarchy.",
        actionTier: "execute_with_approval",
        sgdDelta: 0,
        policyRank: POLICY_TIERS.statutory,
        sourceQuote: null,
      },
    ],
    transcript: [
      {
        speaker: "Daniel Tan",
        text: "The cooling tower conductivity has been running high and the blowdown schedule has slipped.",
      },
      {
        speaker: "Daniel Tan",
        text: "Biocide dosing is a statutory requirement and must be restored before the next water test.",
      },
    ],
  },
};

/** Never published. Proves that a draft pill cannot reach a decision card. */
const VAV_REHEAT_DRAFT: PillSeedEntry = {
  slug: "vav-box-reheat-valve-calibration",
  publish: false,
  input: {
    title: "VAV Box Reheat Valve Calibration",
    domain: "vav_box",
    summary: "Calibrate the reheat valve on a hunting VAV box before replacing the actuator.",
    triggers: ["vav reheat valve", "reheat valve stuck", "zone temperature hunting"],
    steps: [
      "Stroke the reheat valve and confirm full travel.",
      "Re-calibrate the actuator end stops.",
    ],
    actionTier: "recommend",
    contextRequirements: {
      assetTypes: ["vav_box"],
      chillerPlant: "CP-1",
      tariffSgdPerKwh: null,
      minGfaSqm: null,
    },
    claims: [
      {
        kind: "measured",
        text: "The zone temperature is hunting across a 2 °C band.",
        sourceQuote: "zone temperature is hunting across about two degrees",
        confidence: 0.75,
      },
    ],
    options: [],
    transcript: [
      {
        speaker: "Daniel Tan",
        text: "The zone temperature is hunting across about two degrees on the level 19 VAV box.",
      },
    ],
  },
};

export const PILL_CAPTURE_DATASET: readonly PillSeedEntry[] = [
  CHILLER_STAGING,
  CONDENSER_FOULING,
  AHU_NIGHT_PURGE,
  TENANT_COMFORT_BAND,
  WATER_HYGIENE,
  VAV_REHEAT_DRAFT,
];
