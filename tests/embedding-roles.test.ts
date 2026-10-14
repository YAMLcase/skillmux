import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClients } from "../src/clients";
import { backfillEmbeddings, closeRuntime, configure, resolveSkill } from "../src/router-core";
import type { Config } from "../src/types";

test("retrieval instructs Harrier queries while indexing and reranking keep their original text", async () => {
  const tmp = mkdtempSync(join(tmpdir(), "skillmux-embedding-roles-"));
  const embeddingInputs: string[][] = [];
  const rerankQueries: string[] = [];
  const server = Bun.serve({
    port: 0,
    async fetch(req) {
      const body = await req.json() as { input?: string[]; query?: string; documents?: string[] };
      if (body.input) {
        embeddingInputs.push(body.input);
        return Response.json({
          data: body.input.map((_, index) => ({ index, embedding: [1, 0, 0] })),
        });
      }
      rerankQueries.push(body.query!);
      return Response.json({
        results: body.documents!.map((_, index) => ({ index, relevance_score: 0.9 })),
      });
    },
  });
  const vault = join(tmp, "vault");
  const config: Config = {
    vault_path: vault,
    local_vault_paths: [],
    agents: [],
    state_dir: join(tmp, "state"),
    recall: { k_lexical: 5, k_vector: 5, k_rerank: 5 },
    output: { top_k: 5, max_top_k: 5 },
    inference: {
      mode: "remote",
      timeout_ms: 2000,
      embedding: {
        provider: "openai",
        endpoint: `http://127.0.0.1:${server.port}/v1/embeddings`,
        model: "microsoft/harrier-oss-v1-0.6b",
        dimension: 3,
      },
      reranker: {
        adapter: "jina-v1",
        endpoint: `http://127.0.0.1:${server.port}/v1/rerank`,
        model: "test-reranker",
      },
    },
  };

  try {
    mkdirSync(join(vault, "container-help"), { recursive: true });
    writeFileSync(join(vault, "container-help", "SKILL.md"),
      "---\nname: container-help\ndescription: Diagnose stopped containers.\n---\nbody");
    configure({ config, clients: createClients(config) });
    await backfillEmbeddings();
    const result = await resolveSkill({ query: "diagnose stopped containers" });

    expect(embeddingInputs).toEqual([
      ["container-help\nDiagnose stopped containers.\n"],
      ["Instruct: Given a task description, retrieve relevant skills that help complete the task.\nQuery: diagnose stopped containers"],
    ]);
    expect(rerankQueries).toEqual(["diagnose stopped containers"]);
    expect(result.retrieval).toBe("reranked");
    expect(result.candidates.map((candidate) => candidate.skill_id)).toEqual(["container-help"]);
  } finally {
    closeRuntime();
    configure({});
    server.stop(true);
    rmSync(tmp, { recursive: true, force: true });
  }
});
