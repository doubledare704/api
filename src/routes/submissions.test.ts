import { Hono } from "hono";
import { describe, expect, test } from "vitest";
import type { Bindings } from "../types";
import { registerSubmissionRoutes } from "./submissions";

type TokenFixture = {
  id: string;
  claimed_at: string | null;
};

type SubmissionFixture = {
  id: string;
  token_id: string;
  model: string;
  provider: string | null;
  score_percentage: number;
  total_score: number;
  max_score: number;
  total_execution_time_seconds: number | null;
  total_cost_usd: number | null;
  timestamp: string;
  created_at: string;
  client_version: string | null;
  openclaw_version: string | null;
  benchmark_version: string | null;
  official: number;
};

type QueryExecution = {
  method: "all" | "first";
  sql: string;
  bindings: Array<string | number>;
};

const tokens: TokenFixture[] = [
  { id: "token-claimed-a", claimed_at: "2026-01-01T00:00:00Z" },
  { id: "token-claimed-b", claimed_at: "2026-01-02T00:00:00Z" },
  { id: "token-unclaimed", claimed_at: null },
];

const submissions: SubmissionFixture[] = [
  {
    id: "submission-alpha-official",
    token_id: "token-claimed-a",
    model: "alpha-model",
    provider: "openai",
    score_percentage: 98,
    total_score: 98,
    max_score: 100,
    total_execution_time_seconds: 12.5,
    total_cost_usd: 0.12,
    timestamp: "2026-01-05T00:00:00Z",
    created_at: "2026-01-05T00:01:00Z",
    client_version: "1.2.3",
    openclaw_version: "0.4.0",
    benchmark_version: "v1",
    official: 1,
  },
  {
    id: "submission-beta-claimed",
    token_id: "token-claimed-b",
    model: "beta-model",
    provider: "openai",
    score_percentage: 91,
    total_score: 91,
    max_score: 100,
    total_execution_time_seconds: 15,
    total_cost_usd: 0.08,
    timestamp: "2026-01-06T00:00:00Z",
    created_at: "2026-01-06T00:01:00Z",
    client_version: "1.2.3",
    openclaw_version: "0.4.0",
    benchmark_version: "v1",
    official: 0,
  },
  {
    id: "submission-alpha-unclaimed",
    token_id: "token-unclaimed",
    model: "alpha-model",
    provider: "anthropic",
    score_percentage: 91,
    total_score: 91,
    max_score: 100,
    total_execution_time_seconds: 18,
    total_cost_usd: 0.2,
    timestamp: "2026-01-04T00:00:00Z",
    created_at: "2026-01-04T00:01:00Z",
    client_version: null,
    openclaw_version: null,
    benchmark_version: "v1",
    official: 0,
  },
  {
    id: "submission-gamma-official-unclaimed",
    token_id: "token-unclaimed",
    model: "gamma-model",
    provider: "google",
    score_percentage: 85,
    total_score: 85,
    max_score: 100,
    total_execution_time_seconds: null,
    total_cost_usd: null,
    timestamp: "2026-01-03T00:00:00Z",
    created_at: "2026-01-03T00:01:00Z",
    client_version: "1.2.0",
    openclaw_version: null,
    benchmark_version: "v1",
    official: 1,
  },
  {
    id: "submission-delta-claimed",
    token_id: "token-claimed-a",
    model: "delta-model",
    provider: "openai",
    score_percentage: 70,
    total_score: 70,
    max_score: 100,
    total_execution_time_seconds: 22,
    total_cost_usd: 0.05,
    timestamp: "2026-01-02T00:00:00Z",
    created_at: "2026-01-02T00:01:00Z",
    client_version: "1.1.0",
    openclaw_version: "0.3.0",
    benchmark_version: "v1",
    official: 0,
  },
  {
    id: "submission-legacy-version",
    token_id: "token-claimed-a",
    model: "alpha-model",
    provider: "openai",
    score_percentage: 80,
    total_score: 80,
    max_score: 100,
    total_execution_time_seconds: 20,
    total_cost_usd: 0.1,
    timestamp: "2025-12-30T00:00:00Z",
    created_at: "2025-12-30T00:01:00Z",
    client_version: "1.0.0",
    openclaw_version: "0.2.0",
    benchmark_version: "v0",
    official: 0,
  },
];

class FixtureD1 {
  readonly executions: QueryExecution[] = [];

  prepare(sql: string) {
    const buildStatement = (bindings: Array<string | number>) => ({
      bind: (...nextBindings: Array<string | number>) => buildStatement(nextBindings),
      all: async () => {
        this.executions.push({ method: "all", sql, bindings });
        return { results: this.executeAll(sql, bindings) };
      },
      first: async <T>() => {
        this.executions.push({ method: "first", sql, bindings });
        return this.executeFirst(sql, bindings) as T | null;
      },
    });

    return buildStatement([]);
  }

  countQuery() {
    const execution = this.executions.find((entry) =>
      /SELECT\s+COUNT\(\*\) as total/i.test(entry.sql),
    );

    if (!execution) {
      throw new Error("COUNT query was not executed");
    }

    return execution;
  }

  legacyJoinedCount(filters: {
    model?: string;
    provider?: string;
    verified?: boolean;
    official?: boolean;
    versions?: string[];
  }) {
    return this.filterSubmissions(
      `
        SELECT COUNT(*) as total
        FROM submissions s
        JOIN tokens t ON s.token_id = t.id
        WHERE 1=1
        ${filters.model ? "AND s.model = ?" : ""}
        ${filters.provider ? "AND s.provider = ?" : ""}
        ${filters.verified ? "AND t.claimed_at IS NOT NULL" : ""}
        ${filters.official ? "AND s.official = 1" : ""}
        ${filters.versions?.length ? `AND s.benchmark_version IN (${filters.versions.map(() => "?").join(", ")})` : ""}
      `,
      [
        ...(filters.model ? [filters.model] : []),
        ...(filters.provider ? [filters.provider] : []),
        ...(filters.versions ?? []),
      ],
    ).length;
  }

  estimateCountRowsRead(execution: QueryExecution) {
    const submissionRows = this.filterSubmissions(execution.sql, execution.bindings).length;
    const tokenRows = /JOIN\s+tokens\s+t/i.test(execution.sql) ? tokens.length : 0;
    return submissionRows + tokenRows;
  }

  private executeAll(sql: string, bindings: Array<string | number>) {
    if (/FROM\s+benchmark_versions/i.test(sql)) {
      return [{ id: "v1" }];
    }

    if (/FROM\s+submissions\s+s/i.test(sql)) {
      return this.filterSubmissions(sql, bindings).map((submission) => {
        const token = this.tokenFor(submission);
        return {
          id: submission.id,
          model: submission.model,
          provider: submission.provider,
          score_percentage: submission.score_percentage,
          total_score: submission.total_score,
          max_score: submission.max_score,
          total_execution_time_seconds: submission.total_execution_time_seconds,
          total_cost_usd: submission.total_cost_usd,
          timestamp: submission.timestamp,
          created_at: submission.created_at,
          client_version: submission.client_version,
          openclaw_version: submission.openclaw_version,
          benchmark_version: submission.benchmark_version,
          official: submission.official,
          claimed: token?.claimed_at ? 1 : 0,
        };
      });
    }

    throw new Error(`Unexpected all() query: ${sql}`);
  }

  private executeFirst(sql: string, bindings: Array<string | number>) {
    if (/FROM\s+benchmark_versions/i.test(sql)) {
      return bindings[0] === "v1" ? { id: "v1" } : null;
    }

    if (/SELECT\s+COUNT\(\*\) as total/i.test(sql)) {
      return { total: this.filterSubmissions(sql, bindings).length };
    }

    throw new Error(`Unexpected first() query: ${sql}`);
  }

  private filterSubmissions(sql: string, bindings: Array<string | number>) {
    let bindingIndex = 0;
    let rows = [...submissions];

    if (/JOIN\s+tokens\s+t/i.test(sql)) {
      rows = rows.filter((submission) => this.tokenFor(submission));
    }

    if (/s\.model\s+=\s+\?/i.test(sql)) {
      const model = bindings[bindingIndex++];
      rows = rows.filter((submission) => submission.model === model);
    }

    if (/s\.provider\s+=\s+\?/i.test(sql)) {
      const provider = bindings[bindingIndex++];
      rows = rows.filter((submission) => submission.provider === provider);
    }

    if (/AND\s+t\.claimed_at\s+IS\s+NOT\s+NULL/i.test(sql)) {
      rows = rows.filter((submission) => Boolean(this.tokenFor(submission)?.claimed_at));
    }

    if (/s\.official\s+=\s+1/i.test(sql)) {
      rows = rows.filter((submission) => submission.official === 1);
    }

    const versionMatch = sql.match(/s\.benchmark_version\s+IN\s+\(([^)]+)\)/i);
    if (versionMatch) {
      const versionCount = (versionMatch[1].match(/\?/g) ?? []).length;
      const versions = bindings.slice(bindingIndex, bindingIndex + versionCount);
      bindingIndex += versionCount;
      rows = rows.filter((submission) => versions.includes(submission.benchmark_version ?? ""));
    }

    if (/ORDER\s+BY\s+s\.timestamp\s+DESC/i.test(sql)) {
      rows.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
    } else if (/ORDER\s+BY\s+s\.timestamp\s+ASC/i.test(sql)) {
      rows.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
    } else if (/ORDER\s+BY\s+s\.score_percentage\s+DESC/i.test(sql)) {
      rows.sort(
        (a, b) =>
          b.score_percentage - a.score_percentage ||
          b.timestamp.localeCompare(a.timestamp),
      );
    }

    if (/LIMIT\s+\?\s+OFFSET\s+\?/i.test(sql)) {
      const limit = Number(bindings[bindingIndex++]);
      const offset = Number(bindings[bindingIndex++]);
      rows = rows.slice(offset, offset + limit);
    }

    return rows;
  }

  private tokenFor(submission: SubmissionFixture) {
    return tokens.find((token) => token.id === submission.token_id);
  }
}

const requestSubmissions = async (path: string, db: FixtureD1) => {
  const app = new Hono<{ Bindings: Bindings }>();
  registerSubmissionRoutes(app);

  const response = await app.request(
    `http://example.test${path}`,
    {},
    { prod_pinchbench: db as unknown as Bindings["prod_pinchbench"] },
  );

  expect(response.status).toBe(200);
  return response.json();
};

describe("GET /api/submissions pagination queries", () => {
  test("matches legacy joined-count results while skipping tokens in the default COUNT", async () => {
    const db = new FixtureD1();
    const body = await requestSubmissions("/api/submissions?limit=3&offset=0", db);

    // Parity snapshot: this is the production-equivalent result shape produced
    // by the previous joined COUNT path for valid rows with token FKs.
    expect(body).toMatchInlineSnapshot(`
      {
        "benchmark_version": "v1",
        "benchmark_versions": [
          "v1",
        ],
        "has_more": true,
        "limit": 3,
        "offset": 0,
        "submissions": [
          {
            "benchmark_version": "v1",
            "claimed": 1,
            "client_version": "1.2.3",
            "created_at": "2026-01-05T00:01:00Z",
            "hf_link": null,
            "id": "submission-alpha-official",
            "max_score": 100,
            "model": "alpha-model",
            "official": 1,
            "openclaw_version": "0.4.0",
            "provider": "openai",
            "score_percentage": 98,
            "timestamp": "2026-01-05T00:00:00Z",
            "total_cost_usd": 0.12,
            "total_execution_time_seconds": 12.5,
            "total_score": 98,
            "weights": "Unknown",
          },
          {
            "benchmark_version": "v1",
            "claimed": 1,
            "client_version": "1.2.3",
            "created_at": "2026-01-06T00:01:00Z",
            "hf_link": null,
            "id": "submission-beta-claimed",
            "max_score": 100,
            "model": "beta-model",
            "official": 0,
            "openclaw_version": "0.4.0",
            "provider": "openai",
            "score_percentage": 91,
            "timestamp": "2026-01-06T00:00:00Z",
            "total_cost_usd": 0.08,
            "total_execution_time_seconds": 15,
            "total_score": 91,
            "weights": "Unknown",
          },
          {
            "benchmark_version": "v1",
            "claimed": 0,
            "client_version": null,
            "created_at": "2026-01-04T00:01:00Z",
            "hf_link": null,
            "id": "submission-alpha-unclaimed",
            "max_score": 100,
            "model": "alpha-model",
            "official": 0,
            "openclaw_version": null,
            "provider": "anthropic",
            "score_percentage": 91,
            "timestamp": "2026-01-04T00:00:00Z",
            "total_cost_usd": 0.2,
            "total_execution_time_seconds": 18,
            "total_score": 91,
            "weights": "Unknown",
          },
        ],
        "total": 5,
      }
    `);
    expect(body.total).toBe(db.legacyJoinedCount({ versions: ["v1"] }));

    const countQuery = db.countQuery();
    expect(countQuery.sql).not.toMatch(/JOIN\s+tokens\s+t/i);

    const legacyRowsRead = submissions.filter(
      (submission) => submission.benchmark_version === "v1",
    ).length + tokens.length;
    expect(db.estimateCountRowsRead(countQuery)).toBeLessThan(legacyRowsRead);
  });

  test("preserves the token join when verified filtering needs claimed_at", async () => {
    const db = new FixtureD1();
    const body = await requestSubmissions(
      "/api/submissions?verified=true&model=alpha-model&provider=openai&official=true&limit=5",
      db,
    );

    expect(body.total).toBe(
      db.legacyJoinedCount({
        model: "alpha-model",
        provider: "openai",
        verified: true,
        official: true,
        versions: ["v1"],
      }),
    );
    expect(body.submissions).toEqual([
      expect.objectContaining({
        id: "submission-alpha-official",
        claimed: 1,
        official: 1,
      }),
    ]);

    const countQuery = db.countQuery();
    expect(countQuery.sql).toMatch(/JOIN\s+tokens\s+t/i);
    expect(countQuery.sql).toMatch(/t\.claimed_at\s+IS\s+NOT\s+NULL/i);
  });

  test("does not reintroduce token joins for unverified COUNT variants", async () => {
    for (const path of [
      "/api/submissions?verified=false&limit=2",
      "/api/submissions?official=true&sort=recent&limit=10",
      "/api/submissions?model=alpha-model&provider=anthropic&limit=10",
    ]) {
      const db = new FixtureD1();
      await requestSubmissions(path, db);

      expect(db.countQuery().sql).not.toMatch(/JOIN\s+tokens\s+t/i);
    }
  });
});
