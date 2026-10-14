import { fnv1a32 } from "~/lib/hash";

/** Short, lively names. Picked by hashing an id so a bubble keeps its name across renders and reloads. */
export const AGENT_NAMES = [
  "Pip",
  "Juno",
  "Ziggy",
  "Nova",
  "Milo",
  "Taz",
  "Kiki",
  "Rex",
  "Bo",
  "Zed",
  "Fig",
  "Ivy",
  "Ash",
  "Remy",
  "Sol",
  "Luna",
  "Kit",
  "Jett",
  "Nico",
  "Vex",
  "Momo",
  "Ozzy",
  "Rio",
  "Zara",
  "Tilly",
  "Max",
  "Bear",
  "Echo",
  "Blu",
  "Kai",
  "Lux",
  "Pax",
  "Rue",
  "Scout",
  "Tango",
  "Wren",
  "Ace",
  "Biscuit",
  "Dash",
  "Ember",
] as const;

export function agentName(id: string): string {
  return AGENT_NAMES[fnv1a32(id) % AGENT_NAMES.length]!;
}
