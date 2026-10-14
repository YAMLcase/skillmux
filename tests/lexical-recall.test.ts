import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
