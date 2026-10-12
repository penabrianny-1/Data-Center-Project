import { describe, expect, it } from "vitest";
import { applyResult, changedFields, openDb, stableStringify } from "../lib/db";
import type { Entity } from "../lib/ingest/types";

const bill = (status: string): Entity => ({
  id: "bill:XX-2026-HB1",
  kind: "bill",
  state: "XX",
  title: "HB 1",
  status,
  sources: [{ title: "Official page", url: "https://legis.example.gov/hb1", publisher: "Legislature", kind: "official" }],
  data: { status, title: "HB 1" },
});

describe("change tracking", () => {
  it("records added, updated (with history) and removed without duplicating unchanged records", () => {
    const db = openDb(":memory:");
    const changes = () => db.prepare("SELECT change, fields FROM changes ORDER BY seq").all() as { change: string; fields: string | null }[];

    expect(applyResult(db, "t", "r1", { entities: [bill("introduced")] })).toMatchObject({ added: 1 });
    expect(applyResult(db, "t", "r2", { entities: [bill("introduced")] })).toMatchObject({ unchanged: 1, added: 0, updated: 0 });
    expect(applyResult(db, "t", "r3", { entities: [bill("enacted")] })).toMatchObject({ updated: 1 });

    const hist = db.prepare("SELECT data FROM history").all() as { data: string }[];
    expect(hist).toHaveLength(1);
    expect(JSON.parse(hist[0].data).data.status).toBe("introduced");

    expect(applyResult(db, "t", "r4", { entities: [] })).toMatchObject({ removed: 1 });
    expect(changes().map((c) => c.change)).toEqual(["added", "updated", "removed"]);
    expect(JSON.parse(changes()[1].fields!)).toEqual(["status"]);

    const sources = db.prepare("SELECT COUNT(*) AS n FROM sources").get() as { n: number };
    expect(sources.n).toBe(1);
  });

  it("does not let one adapter's run remove another adapter's records", () => {
    const db = openDb(":memory:");
    applyResult(db, "a", "r1", { entities: [bill("introduced")] });
    applyResult(db, "b", "r2", { entities: [] });
    expect((db.prepare("SELECT COUNT(*) AS n FROM entities").get() as { n: number }).n).toBe(1);
  });

  it("indexes records for full-text search", () => {
    const db = openDb(":memory:");
    applyResult(db, "a", "r1", { entities: [{ ...bill("introduced"), searchText: "moratorium on hyperscale facilities" }] });
    const hits = db.prepare("SELECT id FROM entities_fts WHERE entities_fts MATCH ?").all("hyperscale");
    expect(hits).toHaveLength(1);
  });
});

describe("hashing helpers", () => {
  it("is insensitive to key order", () => {
    expect(stableStringify({ b: 1, a: [2, { d: 1, c: 2 }] })).toBe(stableStringify({ a: [2, { c: 2, d: 1 }], b: 1 }));
  });
  it("reports changed top-level fields", () => {
    expect(changedFields({ a: 1, b: 2 }, { a: 1, b: 3, c: 4 })).toEqual(["b", "c"]);
  });
});

describe("append-only sources", () => {
  it("keeps records a feed no longer returns", () => {
    const db = openDb(":memory:");
    applyResult(db, "news", "r1", { entities: [bill("introduced")] }, undefined, { appendOnly: true });
    expect(applyResult(db, "news", "r2", { entities: [] }, undefined, { appendOnly: true })).toMatchObject({ removed: 0 });
    expect((db.prepare("SELECT COUNT(*) AS n FROM entities").get() as { n: number }).n).toBe(1);
  });
});
