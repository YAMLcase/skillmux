import type { EmbeddingRole } from "./types";

export interface EmbeddingPrefixes {
  query_prefix: string;
  document_prefix: string;
}

const SKILL_QUERY_PREFIX =
  "Instruct: Given a task description, retrieve relevant skills that help complete the task.\nQuery: ";

// Canonical, documented model IDs only. A gateway may prepend its provider path.
const PRESETS = [
  {
    model: /(?:^|\/)(?:microsoft\/harrier-oss-v1-(?:270m|0\.6b|27b)|Qwen\/Qwen3-Embedding-(?:0\.6B|4B|8B))$/,
    query_prefix: SKILL_QUERY_PREFIX,
    document_prefix: "",
  },
  {
    model: /(?:^|\/)intfloat\/(?:e5-(?:small|base|large)-v2|multilingual-e5-(?:small|base|large))$/,
    query_prefix: "query: ",
    document_prefix: "passage: ",
  },
  {
    model: /(?:^|\/)BAAI\/bge-(?:small|base|large)-en-v1\.5$/,
    query_prefix: "Represent this sentence for searching relevant passages: ",
    document_prefix: "",
  },
];

export function resolveEmbeddingPrefixes(embedding: { model: string }): EmbeddingPrefixes {
  const preset = PRESETS.find((entry) => entry.model.test(embedding.model));
  return {
    query_prefix: preset?.query_prefix ?? "",
    document_prefix: preset?.document_prefix ?? "",
  };
}

export function formatEmbeddingInputs(
  texts: string[],
  embedding: { model: string },
  role?: EmbeddingRole,
): string[] {
  if (role === undefined) return texts;
  const prefixes = resolveEmbeddingPrefixes(embedding);
  const prefix = role === "query" ? prefixes.query_prefix : prefixes.document_prefix;
  return prefix ? texts.map((text) => prefix + text) : texts;
}
