// Null means no vesting contract is needed.
// The values aren't used anywhere. They're here just to cross-reference.
const MODALITIES = {
  "FCL Months 2-6": ["2026-03-05T15:00:00Z", "2026-04-05T15:00:00Z", "2026-08-05T15:00:00Z"],
  "SM - 0 - 12": ["2026-02-05T15:00:00Z", "2026-03-05T15:00:00Z", "2027-02-05T15:00:00Z"],
  "SM - 1 - 5": ["2026-03-05T15:00:00Z", "2026-04-05T15:00:00Z", "2026-08-05T15:00:00Z"],
  "SM - 1 - 6 - 20%": ["2026-03-05T15:00:00Z", "2026-04-05T15:00:00Z", "2026-09-05T15:00:00Z"],
  "SM - 1 - 6": ["2026-03-05T15:00:00Z", "2026-04-05T15:00:00Z", "2026-09-05T15:00:00Z"],
  "SM - 12 - 24": ["2027-02-05T15:00:00Z", "2027-03-05T15:00:00Z", "2029-02-05T15:00:00Z"],
  "SM - 12 - 36": ["2027-02-05T15:00:00Z", "2027-03-05T15:00:00Z", "2030-02-05T15:00:00Z"],
  "SM - 6 - 12": ["2026-08-05T15:00:00Z", "2026-09-05T15:00:00Z", "2027-08-05T15:00:00Z"],
  "SM - 6 - 24": ["2026-08-05T15:00:00Z", "2026-09-05T15:00:00Z", "2028-08-05T15:00:00Z"],
  "Staking Rewards": ["2026-02-05T15:00:00Z", "2026-03-05T15:00:00Z", "2036-02-05T15:00:00Z"],
  Treasury: ["2026-03-05T15:00:00Z", "2026-04-05T15:00:00Z", "2031-03-05T15:00:00Z"],
  Masterlist: null,
  "C - 12 - 36": null,
  "C - 6 - 36": null,
} as const;
export type Modality = keyof typeof MODALITIES;

// Made it an int-indexed object instead of a list to make mistakes obvious.
const EVM_MODALITIES = {
  0: "DIRECT",
  1: "VESTED_0_12",
  2: "VESTED_0_120",
  3: "VESTED_1_5",
  4: "VESTED_1_6",
  5: "VESTED_1_60",
  6: "VESTED_6_12",
  7: "VESTED_6_24",
  8: "VESTED_12_24",
  9: "VESTED_12_36",
} as const;
export type EVMModality = keyof typeof EVM_MODALITIES;

export const MODALITIES_TS_TO_EVM: Record<Modality, EVMModality> = {
  "FCL Months 2-6": 3,
  "SM - 0 - 12": 1,
  "SM - 1 - 5": 3,
  "SM - 1 - 6 - 20%": 4,
  "SM - 1 - 6": 4,
  "SM - 12 - 24": 8,
  "SM - 12 - 36": 9,
  "SM - 6 - 12": 6,
  "SM - 6 - 24": 7,
  "Staking Rewards": 2,
  Treasury: 5,
  Masterlist: 0,
  "C - 12 - 36": 0,
  "C - 6 - 36": 0,
};

export function isKnownModality(s: string): s is Modality {
  return s in MODALITIES;
}
