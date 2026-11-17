import type { RosterEntry } from "./sheet-parse";

/** Case-insensitive match of a mentioned name against active roster names/aliases. */
export function matchesRoster(name: string, roster: RosterEntry[]): boolean {
  const n = name.trim().toLowerCase();
  return roster.some((r) => r.active && (r.name.toLowerCase() === n || r.aliases.some((a) => a.toLowerCase() === n)));
}
