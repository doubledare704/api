import { describe, test, expect } from "vitest";
import { Hono } from "hono";
import type { D1Database } from "@cloudflare/workers-types";
import type { Bindings } from "../types";
import { parseSemver, isValidSemver, compareSemver } from "./benchmarkVersions";
import { registerBenchmarkVersionRoutes } from "./benchmarkVersions";

type BenchmarkVersionFixture = {
  id: string;
  created_at: string;
  current: number;
  hidden: number;
  semver: string | null;
  label: string | null;
  release_notes: string | null;
  release_url: string | null;
};

type SubmissionFixture = {
  id: string;
  benchmark_version: string | null;
};

type QueryLogEntry = {
  sql: string;
  params: unknown[];
  operation: "all" | "first";
};

function createBenchmarkVersionFixtures(): BenchmarkVersionFixture[] {
  return [
    {
      id: "v2-release",
      created_at: "2026-05-01T00:00:00.000Z",
      current: 1,
      hidden: 0,
      semver: "2.0.0",
      label: "2.0.0",
      release_notes: "latest stable",
      release_url: "https://example.com/v2",
    },
    {
      id: "v2-rc1",
      created_at: "2026-04-15T00:00:00.000Z",
      current: 0,
      hidden: 0,
      semver: "2.0.0-rc.1",
      label: null,
      release_notes: null,
      release_url: null,
    },
    {
      id: "v1-2-2-dev13",
      created_at: "2026-04-01T00:00:00.000Z",
      current: 0,
      hidden: 0,
      semver: "1.2.2-dev.13+gabc1234",
      label: null,
      release_notes: "dev build",
      release_url: null,
    },
    {
      id: "v1-2-2-dev1",
      created_at: "2026-03-20T00:00:00.000Z",
      current: 0,
      hidden: 0,
      semver: "1.2.2-dev.1+g1111111",
      label: null,
      release_notes: null,
      release_url: null,
    },
    {
      id: "v1-2-1",
      created_at: "2026-03-01T00:00:00.000Z",
      current: 0,
      hidden: 0,
      semver: "1.2.1",
      label: null,
      release_notes: null,
      release_url: null,
    },
    {
      id: "beta10",
      created_at: "2026-02-10T00:00:00.000Z",
      current: 0,
      hidden: 0,
      semver: "1.0.0-beta.10",
      label: null,
      release_notes: null,
      release_url: null,
    },
    {
      id: "beta2",
      created_at: "2026-02-02T00:00:00.000Z",
      current: 0,
      hidden: 0,
      semver: "1.0.0-beta.2",
      label: null,
      release_notes: null,
      release_url: null,
    },
    {
      id: "legacy-high",
      created_at: "2026-01-20T00:00:00.000Z",
      current: 0,
      hidden: 0,
      semver: null,
      label: "Legacy High",
      release_notes: null,
      release_url: null,
    },
    {
      id: "legacy-low",
      created_at: "2026-01-01T00:00:00.000Z",
      current: 0,
      hidden: 0,
      semver: "not-semver",
      label: null,
      release_notes: null,
      release_url: null,
    },
    {
      id: "zero-submissions",
      created_at: "2025-12-01T00:00:00.000Z",
      current: 0,
      hidden: 0,
      semver: "0.9.0",
      label: null,
      release_notes: null,
      release_url: null,
    },
    {
      id: "hidden-with-submissions",
      created_at: "2026-06-01T00:00:00.000Z",
      current: 0,
      hidden: 1,
      semver: "9.9.9",
      label: "Hidden",
      release_notes: null,
      release_url: null,
    },
  ];
}

function createSubmissionFixtures(): SubmissionFixture[] {
  const distribution: Record<string, number> = {
    "v2-release": 300,
    "v2-rc1": 125,
    "v1-2-2-dev13": 180,
    "v1-2-2-dev1": 90,
    "v1-2-1": 75,
    beta10: 60,
    beta2: 45,
    "legacy-high": 35,
    "legacy-low": 20,
    "hidden-with-submissions": 70,
  };

  return Object.entries(distribution).flatMap(([benchmarkVersion, count]) =>
    Array.from({ length: count }, (_, index) => ({
      id: `${benchmarkVersion}-${index}`,
      benchmark_version: benchmarkVersion,
    })),
  );
}

function getFixtureLabel(version: BenchmarkVersionFixture): string {
  return version.label ?? version.semver ?? version.id.slice(0, 8);
}

function legacyBenchmarkVersionsSnapshot(
  versions: BenchmarkVersionFixture[],
  submissions: SubmissionFixture[],
) {
  const visibleVersions = versions
    .filter((version) => version.hidden === 0)
    .sort(
      (a, b) =>
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
    );

  const versionsWithCounts = visibleVersions.map((version) => ({
    id: version.id,
    created_at: version.created_at,
    is_current: version.current === 1,
    submission_count: submissions.filter(
      (submission) => submission.benchmark_version === version.id,
    ).length,
    semver: version.semver ?? null,
    label: getFixtureLabel(version),
    release_notes: version.release_notes ?? null,
    release_url: version.release_url ?? null,
  }));

  const withSemver = versionsWithCounts.filter(
    (version) => version.semver && isValidSemver(version.semver),
  );
  const withoutSemver = versionsWithCounts.filter(
    (version) => !version.semver || !isValidSemver(version.semver),
  );

  withSemver.sort((a, b) => compareSemver(a.semver!, b.semver!));
  withoutSemver.sort(
    (a, b) =>
      new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
  );

  return [...withSemver, ...withoutSemver];
}

function createMockD1(
  versions: BenchmarkVersionFixture[],
  submissions: SubmissionFixture[],
) {
  const queryLog: QueryLogEntry[] = [];

  const execute = (sql: string, params: unknown[]) => {
    if (
      sql.includes("FROM benchmark_versions") &&
      sql.includes("WHERE hidden = 0")
    ) {
      return versions
        .filter((version) => version.hidden === 0)
        .sort(
          (a, b) =>
            new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
        );
    }

    if (
      sql.includes("FROM benchmark_versions") &&
      sql.includes("WHERE current = 1 AND hidden = 0")
    ) {
      return versions
        .filter((version) => version.current === 1 && version.hidden === 0)
        .sort(
          (a, b) =>
            new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
        )
        .slice(0, 1);
    }

    if (sql.includes("FROM submissions") && sql.includes("GROUP BY benchmark_version")) {
      const versionIds = new Set(params);
      const counts = new Map<string, number>();

      for (const submission of submissions) {
        if (!submission.benchmark_version || !versionIds.has(submission.benchmark_version)) {
          continue;
        }

        counts.set(
          submission.benchmark_version,
          (counts.get(submission.benchmark_version) ?? 0) + 1,
        );
      }

      return [...counts.entries()].map(([benchmark_version, count]) => ({
        benchmark_version,
        count,
      }));
    }

    if (sql.includes("FROM submissions") && sql.includes("WHERE benchmark_version = ?")) {
      const [benchmarkVersion] = params;
      return [
        {
          count: submissions.filter(
            (submission) => submission.benchmark_version === benchmarkVersion,
          ).length,
        },
      ];
    }

    throw new Error(`Unexpected query: ${sql}`);
  };

  const db = {
    prepare: (sql: string) => {
      let boundParams: unknown[] = [];
      const statement = {
        bind: (...params: unknown[]) => {
          boundParams = params;
          return statement;
        },
        all: async <T>() => {
          queryLog.push({ sql, params: boundParams, operation: "all" });
          return { results: execute(sql, boundParams) as T[] };
        },
        first: async <T>() => {
          queryLog.push({ sql, params: boundParams, operation: "first" });
          return (execute(sql, boundParams)[0] ?? null) as T | null;
        },
      };
      return statement;
    },
  } as unknown as D1Database;

  return { db, queryLog };
}

async function requestBenchmarkVersions(
  db: D1Database,
): Promise<{ versions: unknown[]; generated_at: string }> {
  const app = new Hono<{ Bindings: Bindings }>();
  registerBenchmarkVersionRoutes(app);

  const response = await app.request(
    "http://localhost/api/benchmark_versions",
    {},
    { prod_pinchbench: db },
  );

  expect(response.status).toBe(200);
  return response.json();
}

describe("parseSemver", () => {
  test("parses basic version", () => {
    expect(parseSemver("1.2.3")).toEqual({
      major: 1,
      minor: 2,
      patch: 3,
      prerelease: [],
      build: null,
    });
  });

  test("parses version with numeric prerelease", () => {
    expect(parseSemver("1.2.3-dev.13")).toEqual({
      major: 1,
      minor: 2,
      patch: 3,
      prerelease: ["dev", 13],
      build: null,
    });
  });

  test("parses beta prerelease identifiers numerically", () => {
    expect(parseSemver("1.0.0-beta.10")).toEqual({
      major: 1,
      minor: 0,
      patch: 0,
      prerelease: ["beta", 10],
      build: null,
    });
  });

  test("parses version with alphanumeric prerelease", () => {
    expect(parseSemver("1.0.0-alpha.beta.1")).toEqual({
      major: 1,
      minor: 0,
      patch: 0,
      prerelease: ["alpha", "beta", 1],
      build: null,
    });
  });

  test("parses version with build metadata only", () => {
    expect(parseSemver("1.2.3+gabc1234")).toEqual({
      major: 1,
      minor: 2,
      patch: 3,
      prerelease: [],
      build: "gabc1234",
    });
  });

  test("parses version with prerelease and build metadata", () => {
    expect(parseSemver("1.2.2-dev.13+gabc1234")).toEqual({
      major: 1,
      minor: 2,
      patch: 2,
      prerelease: ["dev", 13],
      build: "gabc1234",
    });
  });

  test("parses version with complex build metadata", () => {
    expect(parseSemver("1.0.0-rc.1+build.123.sha.abc")).toEqual({
      major: 1,
      minor: 0,
      patch: 0,
      prerelease: ["rc", 1],
      build: "build.123.sha.abc",
    });
  });

  test("rejects versions without all three components", () => {
    expect(parseSemver("1.2")).toBeNull();
    expect(parseSemver("1")).toBeNull();
  });

  test("rejects versions with v prefix", () => {
    expect(parseSemver("v1.2.3")).toBeNull();
  });

  test("rejects non-numeric version components", () => {
    expect(parseSemver("a.b.c")).toBeNull();
    expect(parseSemver("1.x.3")).toBeNull();
  });

  test("rejects completely invalid strings", () => {
    expect(parseSemver("not-a-version")).toBeNull();
    expect(parseSemver("")).toBeNull();
  });
});

describe("isValidSemver", () => {
  test("accepts valid basic versions", () => {
    expect(isValidSemver("1.0.0")).toBe(true);
    expect(isValidSemver("0.0.1")).toBe(true);
    expect(isValidSemver("123.456.789")).toBe(true);
  });

  test("accepts versions with prerelease", () => {
    expect(isValidSemver("1.2.3-alpha")).toBe(true);
    expect(isValidSemver("1.2.3-dev.13")).toBe(true);
    expect(isValidSemver("1.0.0-0.3.7")).toBe(true);
    expect(isValidSemver("1.0.0-x.7.z.92")).toBe(true);
  });

  test("accepts versions with build metadata", () => {
    expect(isValidSemver("1.2.3+build")).toBe(true);
    expect(isValidSemver("1.2.3+gabc1234")).toBe(true);
    expect(isValidSemver("1.0.0+20130313144700")).toBe(true);
  });

  test("accepts versions with prerelease and build metadata", () => {
    expect(isValidSemver("1.2.2-dev.13+gabc1234")).toBe(true);
    expect(isValidSemver("1.0.0-alpha+001")).toBe(true);
  });

  test("rejects invalid versions", () => {
    expect(isValidSemver("1.2")).toBe(false);
    expect(isValidSemver("v1.2.3")).toBe(false);
    expect(isValidSemver("not-valid")).toBe(false);
  });
});

describe("compareSemver", () => {
  describe("basic version ordering (descending)", () => {
    test("major version differences", () => {
      expect(compareSemver("1.0.0", "2.0.0")).toBeGreaterThan(0); // 2.0.0 > 1.0.0
      expect(compareSemver("2.0.0", "1.0.0")).toBeLessThan(0);
      expect(compareSemver("10.0.0", "2.0.0")).toBeLessThan(0);
    });

    test("minor version differences", () => {
      expect(compareSemver("1.1.0", "1.0.0")).toBeLessThan(0); // 1.1.0 > 1.0.0
      expect(compareSemver("1.0.0", "1.1.0")).toBeGreaterThan(0);
      expect(compareSemver("1.10.0", "1.2.0")).toBeLessThan(0);
    });

    test("patch version differences", () => {
      expect(compareSemver("1.0.1", "1.0.0")).toBeLessThan(0); // 1.0.1 > 1.0.0
      expect(compareSemver("1.0.0", "1.0.1")).toBeGreaterThan(0);
    });

    test("equal versions", () => {
      expect(compareSemver("1.0.0", "1.0.0")).toBe(0);
      expect(compareSemver("2.5.10", "2.5.10")).toBe(0);
    });
  });

  describe("prerelease precedence", () => {
    test("prerelease is less than release", () => {
      // For descending sort: release should come first (be "less than" in sort)
      expect(compareSemver("1.2.2-dev.13", "1.2.2")).toBeGreaterThan(0); // 1.2.2 > 1.2.2-dev.13
      expect(compareSemver("1.2.2", "1.2.2-dev.13")).toBeLessThan(0);
      expect(compareSemver("1.0.0-alpha", "1.0.0")).toBeGreaterThan(0);
    });

    test("prerelease with higher patch is greater than lower release", () => {
      // 1.2.2-dev.13 > 1.2.1 (patch bump matters even for prereleases)
      expect(compareSemver("1.2.2-dev.13", "1.2.1")).toBeLessThan(0);
      expect(compareSemver("1.2.1", "1.2.2-dev.13")).toBeGreaterThan(0);
    });

    test("numeric prerelease identifiers sorted numerically", () => {
      // dev.13 > dev.1 (numeric comparison, not lexicographic)
      expect(compareSemver("1.0.0-dev.1", "1.0.0-dev.13")).toBeGreaterThan(0);
      expect(compareSemver("1.0.0-dev.13", "1.0.0-dev.1")).toBeLessThan(0);
      expect(compareSemver("1.0.0-dev.2", "1.0.0-dev.10")).toBeGreaterThan(0);
    });

    test("alphanumeric prerelease identifiers sorted lexicographically", () => {
      expect(compareSemver("1.0.0-alpha", "1.0.0-beta")).toBeGreaterThan(0); // beta > alpha
      expect(compareSemver("1.0.0-beta", "1.0.0-alpha")).toBeLessThan(0);
    });

    test("numeric identifiers have lower precedence than alphanumeric", () => {
      // Per spec: numeric < alphanumeric
      expect(compareSemver("1.0.0-1", "1.0.0-alpha")).toBeGreaterThan(0); // alpha > 1
    });

    test("fewer prerelease identifiers = lower precedence", () => {
      // 1.0.0-alpha < 1.0.0-alpha.1
      expect(compareSemver("1.0.0-alpha", "1.0.0-alpha.1")).toBeGreaterThan(0);
    });
  });

  describe("build metadata handling", () => {
    test("build metadata is ignored in comparison", () => {
      expect(compareSemver("1.2.2+build1", "1.2.2+build2")).toBe(0);
      expect(compareSemver("1.2.2+abc", "1.2.2+xyz")).toBe(0);
      expect(compareSemver("1.2.2", "1.2.2+build")).toBe(0);
    });

    test("build metadata ignored with prerelease", () => {
      expect(compareSemver("1.2.2-dev.13+abc", "1.2.2-dev.13+xyz")).toBe(0);
      expect(compareSemver("1.2.2-dev.13+build", "1.2.2-dev.13")).toBe(0);
    });
  });

  describe("ahead-of-tag format (real-world cases)", () => {
    test("dev build vs release", () => {
      // Release should sort higher (come first in descending)
      expect(compareSemver("1.2.2-dev.13+gabc1234", "1.2.2")).toBeGreaterThan(0);
    });

    test("dev build vs previous release", () => {
      // 1.2.2-dev.13 > 1.2.1 (it's a prerelease of 1.2.2, which is > 1.2.1)
      expect(compareSemver("1.2.2-dev.13+gabc1234", "1.2.1")).toBeLessThan(0);
    });

    test("dev builds of same version", () => {
      // dev.13 > dev.1
      expect(
        compareSemver("1.2.2-dev.13+gabc1234", "1.2.2-dev.1+g1234567"),
      ).toBeLessThan(0);
    });

    test("sorting multiple versions correctly", () => {
      const versions = [
        "1.2.1",
        "1.2.2-dev.1+g1111111",
        "1.2.2-dev.13+gabc1234",
        "1.2.2",
        "1.3.0-alpha",
      ];
      const sorted = [...versions].sort(compareSemver);
      // Expected descending order:
      // 1.3.0-alpha (prerelease of 1.3.0, but 1.3.0 > 1.2.x)
      // 1.2.2 (release)
      // 1.2.2-dev.13 (prerelease, dev.13 > dev.1)
      // 1.2.2-dev.1 (prerelease)
      // 1.2.1 (older release)
      expect(sorted).toEqual([
        "1.3.0-alpha",
        "1.2.2",
        "1.2.2-dev.13+gabc1234",
        "1.2.2-dev.1+g1111111",
        "1.2.1",
      ]);
    });

    test("sorting legacy beta versions correctly", () => {
      const versions = [
        "1.0.0-beta.1",
        "0.9.0",
        "1.0.0-beta.10",
        "1.0.0",
        "1.0.0-beta.2",
      ];

      expect([...versions].sort(compareSemver)).toEqual([
        "1.0.0",
        "1.0.0-beta.10",
        "1.0.0-beta.2",
        "1.0.0-beta.1",
        "0.9.0",
      ]);
    });
  });

  describe("invalid version handling", () => {
    test("invalid versions sort to end", () => {
      expect(compareSemver("1.0.0", "invalid")).toBeLessThan(0);
      expect(compareSemver("invalid", "1.0.0")).toBeGreaterThan(0);
    });

    test("two invalid versions are equal", () => {
      expect(compareSemver("invalid", "also-invalid")).toBe(0);
    });
  });
});

describe("GET /api/benchmark_versions", () => {
  test("matches the legacy N+1 count snapshot on a production-equivalent fixture", async () => {
    const versions = createBenchmarkVersionFixtures();
    const submissions = createSubmissionFixtures();
    const { db } = createMockD1(versions, submissions);

    const legacySnapshot = legacyBenchmarkVersionsSnapshot(versions, submissions);
    const optimizedResponse = await requestBenchmarkVersions(db);

    expect(optimizedResponse.versions).toEqual(legacySnapshot);
    expect(optimizedResponse.generated_at).toEqual(expect.any(String));
    expect(new Date(optimizedResponse.generated_at).toString()).not.toBe("Invalid Date");
  });

  test("uses one grouped submission count query instead of one query per visible version", async () => {
    const versions = createBenchmarkVersionFixtures();
    const submissions = createSubmissionFixtures();
    const { db, queryLog } = createMockD1(versions, submissions);

    await requestBenchmarkVersions(db);

    const submissionQueries = queryLog.filter((entry) =>
      entry.sql.includes("FROM submissions"),
    );
    const groupedCountQueries = submissionQueries.filter((entry) =>
      entry.sql.includes("GROUP BY benchmark_version"),
    );
    const legacyPointCountQueries = submissionQueries.filter((entry) =>
      entry.sql.includes("WHERE benchmark_version = ?"),
    );

    expect(submissionQueries).toHaveLength(1);
    expect(groupedCountQueries).toHaveLength(1);
    expect(legacyPointCountQueries).toHaveLength(0);

    // The old behavior would issue one submissions count per visible version; keep the API path at two D1 reads total.
    expect(queryLog).toHaveLength(2);
    expect(groupedCountQueries[0].params).toHaveLength(
      versions.filter((version) => version.hidden === 0).length,
    );
  });
});
