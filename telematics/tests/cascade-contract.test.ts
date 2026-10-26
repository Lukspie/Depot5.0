import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { cascadeRisk } from "../src/simulator/cascade.js";

interface Case {
  name: string;
  eta: string;
  departure: string;
  bufferMin: number;
  expected: { severity: string; lateMin: number } | null;
}

// shared with the app (app/tests/test_cascade_contract.py), ADR-047
const { cases } = JSON.parse(readFileSync(new URL("../../contracts/cascade-cases.json", import.meta.url), "utf-8")) as { cases: Case[] };

describe("cascade rule matches the shared cases", () => {
  it.each(cases.map((c) => [c.name, c] as const))("%s", (_name, c) => {
    expect(cascadeRisk(Date.parse(c.eta), Date.parse(c.departure), c.bufferMin)).toEqual(c.expected);
  });
});
