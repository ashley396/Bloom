/** Rotating Bloom Moment content — inspirational, seasonal, and business encouragement. */

export type BloomMomentCategory =
  | "quote"
  | "wisdom"
  | "encouragement"
  | "kindness"
  | "seasonal";

export type BloomMomentEntry = {
  id: string;
  category: BloomMomentCategory;
  label: string;
  text: string;
  attribution?: string;
};

export const bloomMomentEntries: BloomMomentEntry[] = [
  {
    id: "bm-1",
    category: "wisdom",
    label: "Floral wisdom",
    text: "Flowers always make people better, happier, and more helpful; they are sunshine, food, and medicine for the soul.",
    attribution: "Luther Burbank",
  },
  {
    id: "bm-2",
    category: "encouragement",
    label: "Morning encouragement",
    text: "Every arrangement you create today carries someone's unspoken gratitude. Start gently — the day will unfold beautifully.",
  },
  {
    id: "bm-3",
    category: "seasonal",
    label: "Seasonal note",
    text: "Late summer calls for warm tones and airy textures. Consider garden roses, scabiosa, and trailing amaranth for effortless elegance.",
  },
  {
    id: "bm-4",
    category: "kindness",
    label: "Customer kindness",
    text: "A handwritten note on a sympathy arrangement can mean more than the flowers themselves. Small gestures, lasting impact.",
  },
  {
    id: "bm-5",
    category: "quote",
    label: "Inspiration",
    text: "Where flowers bloom, so does hope.",
    attribution: "Lady Bird Johnson",
  },
  {
    id: "bm-6",
    category: "wisdom",
    label: "Floral wisdom",
    text: "Design with restraint. Three focal flowers often speak louder than twelve competing blooms.",
  },
  {
    id: "bm-7",
    category: "encouragement",
    label: "Business encouragement",
    text: "Your craft is irreplaceable. Technology supports your artistry — it never replaces the human touch at your design table.",
  },
  {
    id: "bm-8",
    category: "seasonal",
    label: "Holiday countdown",
    text: "Valentine's preparation begins now. Review rose inventory, confirm delivery routes, and schedule extra design bench time.",
  },
];

/** Deterministic daily rotation — same quote all day, changes at midnight local time. */
export function getTodaysBloomMoment(date = new Date()): BloomMomentEntry {
  const dayIndex =
    date.getFullYear() * 366 + date.getMonth() * 31 + date.getDate();
  return bloomMomentEntries[dayIndex % bloomMomentEntries.length]!;
}

export const bloomMomentCategoryLabel: Record<BloomMomentCategory, string> = {
  quote: "Inspirational quote",
  wisdom: "Floral wisdom",
  encouragement: "Business encouragement",
  kindness: "Customer kindness",
  seasonal: "Seasonal message",
};
