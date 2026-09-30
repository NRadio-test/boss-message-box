import { expect, it } from "vitest";
import { normalizeCountry, normalizeProbeRegion, shareIpRegions } from "../../src/features/iptest/region";

it("normalizes country codes and exact place names without guessing from city text", () => {
  expect(normalizeCountry(" sg ")).toBe("SG");
  expect(normalizeCountry("constructor")).toBeUndefined();
  expect(normalizeProbeRegion("sg")).toEqual({ country: "SG", location: undefined });
  expect(normalizeProbeRegion("新加坡 新加坡 新加坡")).toEqual({ country: "SG", location: "新加坡" });
  expect(normalizeProbeRegion("Hong Kong")).toEqual({ country: "HK", location: "Hong Kong" });
  expect(normalizeProbeRegion("美国 纽约 某运营商").country).toBeUndefined();
  expect(normalizeProbeRegion("New York").location).toBe("New York");
});

it("shares only country evidence for the same IP, without inventing cities or carriers", () => {
  const rows = shareIpRegions({
    echo: { status: "ok", ip: "1.1.1.1" },
    trace: { status: "ok", ip: "1.1.1.1", country: "SG", location: "Singapore", organization: "Example" },
    other: { status: "ok", ip: "8.8.8.8" },
  });
  expect(rows.echo).toEqual({ status: "ok", ip: "1.1.1.1", country: "SG" });
  expect(rows.other?.country).toBeUndefined();
});

it("withdraws inferred country when observations conflict, preserving original evidence", () => {
  const rows = shareIpRegions({
    echo: { status: "ok", ip: "1.1.1.1" },
    first: { status: "ok", ip: "1.1.1.1", country: "SG" },
    second: { status: "ok", ip: "1.1.1.1", country: "US" },
  });
  expect(rows.echo?.country).toBeUndefined();
  expect(rows.first?.country).toBe("SG");
  expect(rows.second?.country).toBe("US");
});
