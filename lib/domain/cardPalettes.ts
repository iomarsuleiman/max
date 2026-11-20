/** Kept apart from the card schema so the app shell can tint the sidebar without loading zod. */
/** Each card theme's colors. They also tint your space (the sidebar and backdrop). */
export const cardPalettes = {
  sunset: { ink: "#ad3e10", first: "#ffb52d", second: "#ff7e94", dark: "#ee6c30", glow: "#ffe6a1" },
  ocean: { ink: "#27596e", first: "#42a9bc", second: "#82d4c3", dark: "#3762a2", glow: "#c5f2e5" },
  sage: { ink: "#3c5c3e", first: "#b8ce77", second: "#79a487", dark: "#4c7958", glow: "#e6ecab" },
  clay: { ink: "#854733", first: "#e6a46f", second: "#dc897a", dark: "#ba6047", glow: "#f9d5a1" },
  lilac: { ink: "#684778", first: "#bc9fda", second: "#eea4be", dark: "#8864b2", glow: "#f6d5eb" },
  rose: { ink: "#8b3d57", first: "#edafbf", second: "#f2b79d", dark: "#c86c91", glow: "#ffe2c5" },
  mint: { ink: "#236254", first: "#3dc6aa", second: "#c7e5d8", dark: "#299c90", glow: "#e3f3bd" },
  amber: { ink: "#885516", first: "#efc64e", second: "#e09b59", dark: "#bf7c28", glow: "#fff0b2" },
  midnight: { ink: "#344865", first: "#506f9b", second: "#8ba6bd", dark: "#253955", glow: "#ccdde7" },
  lagoon: { ink: "#245d6b", first: "#41b8bc", second: "#9fd6d1", dark: "#327f9f", glow: "#d2eee0" },
  plum: { ink: "#673c65", first: "#a96ba0", second: "#d9a7b9", dark: "#724f8c", glow: "#f4d9ca" },
  citrus: { ink: "#5e6520", first: "#c6d661", second: "#edcf7d", dark: "#89ac59", glow: "#f8f1b7" },
} satisfies Record<string, { ink: string; first: string; second: string; dark: string; glow: string }>;

export const cardPalette = (theme: string) => cardPalettes[theme as keyof typeof cardPalettes] ?? cardPalettes.sunset;
