/**
 * The historical ticket set — the retrieval eval fixture.
 *
 * Each row is a real-shaped complaint plus the pill a chief engineer would expect to be
 * retrieved. `eval.service.ts` runs the whole set through retrieval and reports precision and
 * recall, so a trigger edit that degrades the library fails CI.
 *
 * Note the deliberate collisions: two pills live in `chiller_plant`, and the ticket set is run
 * without a domain filter, so retrieval has to discriminate on the symptom text alone.
 */

export interface TicketCase {
  id: string;
  symptom: string;
  /** Optional domain hint. Most tickets deliberately leave this unset. */
  domain?: string;
  expectedPillSlug: string;
}

export const TICKETS_DATASET: readonly TicketCase[] = [
  {
    id: "ticket-0001",
    symptom: "Chiller plant efficiency drift, staging sequence appears wrong",
    expectedPillSlug: "chiller-plant-staging-drift",
  },
  {
    id: "ticket-0002",
    symptom: "Chiller staging lead lag rotation looks incorrect and plant efficiency is degrading",
    expectedPillSlug: "chiller-plant-staging-drift",
  },
  {
    id: "ticket-0003",
    symptom: "Level 23 too hot and stuffy, chiller plant efficiency drifted",
    expectedPillSlug: "chiller-plant-staging-drift",
  },
  {
    id: "ticket-0004",
    symptom: "Condenser approach temperature has risen, suspect tube fouling",
    expectedPillSlug: "chiller-condenser-tube-fouling",
  },
  {
    id: "ticket-0005",
    symptom: "Condenser water delta t is low, condenser tube fouling likely",
    expectedPillSlug: "chiller-condenser-tube-fouling",
  },
  {
    id: "ticket-0006",
    symptom: "Night purge via AHU economiser cycle, fresh air damper stuck",
    expectedPillSlug: "ahu-night-purge-and-economiser-cycle",
  },
  {
    id: "ticket-0007",
    symptom: "Stale air on level 12, economiser damper not opening",
    expectedPillSlug: "ahu-night-purge-and-economiser-cycle",
  },
  {
    id: "ticket-0008",
    symptom: "AHU ventilation poor, co2 level high in the morning",
    expectedPillSlug: "ahu-night-purge-and-economiser-cycle",
  },
  {
    id: "ticket-0009",
    symptom: "Tenant reports overcooling, too cold against lease comfort band",
    expectedPillSlug: "tenant-comfort-band-review",
  },
  {
    id: "ticket-0010",
    symptom: "Complaint of too cold in the tenant area, review lease comfort band",
    expectedPillSlug: "tenant-comfort-band-review",
  },
  {
    id: "ticket-0011",
    symptom: "Cooling tower conductivity high, blowdown schedule needs review",
    expectedPillSlug: "cooling-tower-water-hygiene-routine",
  },
  {
    id: "ticket-0012",
    symptom: "Cooling tower water treatment biocide dosing is overdue",
    expectedPillSlug: "cooling-tower-water-hygiene-routine",
  },
];

/** Red-flag phrasings the gate must catch, one per rule family. Used by the gate test. */
export const GATE_POSITIVE_FIXTURES: readonly { text: string; severity: string }[] = [
  { text: "There is smoke coming from the AHU on level 12", severity: "safety" },
  { text: "Strong burning smell in the riser cupboard", severity: "safety" },
  { text: "Refrigerant leak smell near the chiller plant", severity: "safety" },
  { text: "The fire alarm panel is showing a fault and we evacuated level 9", severity: "safety" },
  { text: "The CO detector on level 4 is alarming", severity: "safety" },
  { text: "Legionella was detected in the cooling tower sample", severity: "legionella" },
  { text: "Cooling tower water mist shows bacterial growth on the test slide", severity: "legionella" },
  { text: "Two staff members feel dizzy and nauseous on level 23", severity: "illness" },
  { text: "An occupant reported a headache and shortness of breath", severity: "illness" },
  { text: "There is a damp musty smell in the level 7 corridor", severity: "odour" },
  { text: "Tenants complain of a strange smell in the lobby", severity: "odour" },
  { text: "Please set the setpoint to 18 degrees on level 23", severity: "setpoint_band" },
  { text: "Can you lower the thermostat to 27 for the tenant", severity: "setpoint_band" },
];

/** Ordinary comfort/energy complaints that must NOT trip the gate. */
export const GATE_NEGATIVE_FIXTURES: readonly string[] = [
  "Level 23 is too hot and stuffy at 14:40, reported 26.5 C against a target of 23 C",
  "The tenant on level 21 reports the space is too cold against their lease comfort band",
  "Chiller plant efficiency has drifted from 0.62 to 0.71 kW/RT over the past two weeks",
  "Stale air on level 12, the economiser damper is not opening overnight",
  "Cooling tower conductivity is running high and the blowdown schedule has slipped",
  "Lower the chilled water setpoint to 6 degrees to improve dehumidification",
];
