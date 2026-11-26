export const CANONICAL_PRICING_KEYS: Array<{ key: string; label: string; category: string }> = [
  { key: "registration_member", label: "Registration fee", category: "membership" },
  { key: "daycare_single_day", label: "Daycare 1 dog (single day)", category: "daycare" },
  { key: "daycare_and_train:*:*:*", label: "Daycare & Train", category: "daycare" },
  { key: "daycare_2_dogs", label: "Daycare 2 dogs (single day)", category: "daycare" },
  { key: "daycare_3_dogs", label: "Daycare 3 dogs (single day)", category: "daycare" },
  {
    key: "daycare_family_per_dog",
    label: "Daycare family rate per dog (4+ dogs)",
    category: "daycare",
  },
  { key: "daycare_4_dogs", label: "Daycare 4 dogs (single day)", category: "daycare" },
  { key: "daycare_5_dogs", label: "Daycare 5 dogs (single day)", category: "daycare" },
  { key: "daycare_6_dogs", label: "Daycare 6 dogs (single day)", category: "daycare" },
  { key: "daycare_hourly_single_day", label: "Daycare hourly — 1 dog", category: "daycare" },
  { key: "daycare_hourly_2_dogs", label: "Daycare hourly — 2 dogs", category: "daycare" },
  { key: "daycare_hourly_3_dogs", label: "Daycare hourly — 3 dogs", category: "daycare" },
  {
    key: "daycare_hourly_family_per_dog",
    label: "Daycare hourly family rate per dog (4+ dogs)",
    category: "daycare",
  },
  { key: "daycare_hourly_4_dogs", label: "Daycare hourly — 4 dogs", category: "daycare" },
  { key: "daycare_hourly_5_dogs", label: "Daycare hourly — 5 dogs", category: "daycare" },
  { key: "daycare_hourly_6_dogs", label: "Daycare hourly — 6 dogs", category: "daycare" },
  { key: "transport_dubai_shared", label: "Transport Dubai shared", category: "transport" },
  { key: "transport_dubai", label: "Transport Dubai private", category: "transport" },
  { key: "transport_abudhabi", label: "Transport Other Emirates", category: "transport" },
];

export const MEMBERSHIP_DISCOUNT_KEYS: Array<{
  tier: "Standard" | "Silver" | "Gold" | "Platinum";
  key: string;
  defaultPct: number;
}> = [
  { tier: "Standard", key: "", defaultPct: 0 },
  { tier: "Silver", key: "membership_discount_silver", defaultPct: 10 },
  { tier: "Gold", key: "membership_discount_gold", defaultPct: 20 },
  { tier: "Platinum", key: "membership_discount_platinum", defaultPct: 30 },
];
