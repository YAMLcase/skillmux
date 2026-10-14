import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import { ftsSearch, openIndex, replaceSkills, type SkillRow } from "../src/db";

function skill(skill_id: string, overrides: Partial<SkillRow> = {}): SkillRow {
  return { skill_id, title: "Tool", description: "Instructions", aliases: "", content_sha256: "hash", ...overrides };
}

function withIndex(run: (db: ReturnType<typeof openIndex>) => void): void {
  const dir = mkdtempSync(join(tmpdir(), "skillmux-lexical-"));
  const db = openIndex(dir);
  try {
    run(db);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

test("lexical search recalls single-character language and numeric terms", () => {
  withIndex((db) => {
    replaceSkills(db, [
      skill("r-help", { title: "R statistics" }),
      skill("c-help", { title: "C programming" }),
      skill("version-help", { description: "Version 7 migration" }),
    ]);
    expect(ftsSearch(db, "R", 5).map((row) => row.skill_id)).toEqual(["r-help"]);
    expect(ftsSearch(db, "7", 5).map((row) => row.skill_id)).toEqual(["version-help"]);
    expect(ftsSearch(db, "   ", 5)).toEqual([]);
    expect(ftsSearch(db, "!?", 5)).toEqual([]);
  });
});

test("opening a legacy index rebuilds searchable IDs and preserves canonical rows, vectors and metadata", () => {
  const dir = mkdtempSync(join(tmpdir(), "skillmux-legacy-fts-"));
  const legacy = new Database(join(dir, "index.sqlite3"));
  legacy.run(`CREATE TABLE skills (
    skill_id TEXT PRIMARY KEY, title TEXT NOT NULL, description TEXT NOT NULL,
    aliases TEXT NOT NULL, content_sha256 TEXT NOT NULL
  )`);
  legacy.run(`CREATE VIRTUAL TABLE skills_fts USING fts5(
    skill_id UNINDEXED, title, description, aliases,
    tokenize = 'unicode61 remove_diacritics 2'
  )`);
  legacy.run(`CREATE TABLE vectors (
    skill_id TEXT PRIMARY KEY, content_sha256 TEXT NOT NULL,
    embedding_fingerprint TEXT NOT NULL DEFAULT '', dim INTEGER NOT NULL, vec BLOB NOT NULL
  )`);
  legacy.run("CREATE TABLE index_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
  legacy.run("INSERT INTO skills VALUES (?, ?, ?, ?, ?)", ["zebra-widget", "Tool", "Instructions", "helper", "sha-original"]);
  legacy.run("INSERT INTO skills_fts VALUES (?, ?, ?, ?)", ["zebra-widget", "Tool", "Instructions", "helper"]);
  legacy.run("INSERT INTO skills_fts VALUES ('deleted-ghost', 'Ghost', '', '')");
  legacy.run("INSERT INTO vectors VALUES (?, ?, ?, ?, ?)", ["zebra-widget", "sha-original", "model:2", 2, new Float32Array([0.25, 0.75])]);
  legacy.run("INSERT INTO index_meta VALUES ('last_indexed_mtime', '123456')");
  const rows = legacy.query("SELECT * FROM skills").all();
  const vectors = legacy.query("SELECT * FROM vectors").all();
  legacy.close();

  let db: Database | undefined;
  try {
    db = openIndex(dir);
    expect(ftsSearch(db, "zebra-widget", 5).map((row) => row.skill_id)).toEqual(["zebra-widget"]);
    expect(ftsSearch(db, "ghost", 5)).toEqual([]);
    expect(db.query("SELECT * FROM skills").all()).toEqual(rows);
    expect(db.query("SELECT * FROM vectors").all()).toEqual(vectors);
    expect(db.query("SELECT value FROM index_meta WHERE key = 'last_indexed_mtime'").get()).toEqual({ value: "123456" });
    db.close();
    db = openIndex(dir);
    expect(ftsSearch(db, "widget", 5).map((row) => row.skill_id)).toEqual(["zebra-widget"]);
    expect(db.query("SELECT * FROM vectors").all()).toEqual(vectors);
  } finally {
    db?.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
