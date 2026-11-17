import { expect, it } from "vitest";
import { matchesRoster } from "./roster-match";
import type { RosterEntry } from "./sheet-parse";

const roster: RosterEntry[] = [
  { name: "Nick", aliases: ["Nicholas"], active: true },
  { name: "MT", aliases: [], active: true },
  { name: "Former Staff", aliases: [], active: false },
];

it("matches on the roster name, case-insensitively", () => {
  expect(matchesRoster("nick", roster)).toBe(true);
  expect(matchesRoster(" MT ", roster)).toBe(true);
});

it("matches on an alias", () => {
  expect(matchesRoster("Nicholas", roster)).toBe(true);
});

it("does not match inactive staff or unknown names", () => {
  expect(matchesRoster("Former Staff", roster)).toBe(false);
  expect(matchesRoster("Random Customer", roster)).toBe(false);
});
