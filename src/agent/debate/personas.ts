import { readFileSync, readdirSync } from "fs";
import { join, resolve } from "path";
import type { AgentPersona, DebateRole, PersonaDefinition } from "../../types/debate.js";

const AGENTS_DIR = resolve(import.meta.dirname, "../../../.claude/agents");

const PERSONA_FILE_MAP: Record<AgentPersona | "moderator", string> = {
  macro: "macro-economist.md",
  tech: "tech-analyst.md",
  geopolitics: "geopolitics.md",
  sentiment: "sentiment-analyst.md",
  moderator: "moderator.md",
};

const EXPERT_PERSONAS: AgentPersona[] = ["macro", "tech", "geopolitics", "sentiment"];

interface Frontmatter {
  name: string;
  description: string;
  model: string;
}

function parseFrontmatter(raw: string): { frontmatter: Frontmatter; body: string } {
  const match = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (match == null) {
    throw new Error("Invalid agent file: missing frontmatter");
  }

  const [, frontmatterBlock, body] = match;
  const frontmatter: Record<string, string> = {};

  for (const line of frontmatterBlock.split("\n")) {
    const colonIndex = line.indexOf(":");
    if (colonIndex === -1) continue;
    const key = line.slice(0, colonIndex).trim();
    const value = line.slice(colonIndex + 1).trim();
    frontmatter[key] = value;
  }

  return {
    frontmatter: frontmatter as unknown as Frontmatter,
    body: body.trim(),
  };
}

function loadPersona(role: DebateRole): PersonaDefinition {
  const filename = PERSONA_FILE_MAP[role];
  const filepath = join(AGENTS_DIR, filename);
  const raw = readFileSync(filepath, "utf-8");
  const { frontmatter, body } = parseFrontmatter(raw);

  return {
    name: role,
    description: frontmatter.description,
    model: frontmatter.model,
    systemPrompt: body,
  };
}

export function loadExpertPersonas(): PersonaDefinition[] {
  return EXPERT_PERSONAS.map(loadPersona);
}

export function loadModeratorPersona(): PersonaDefinition {
  return loadPersona("moderator");
}

export function loadAllPersonas(): PersonaDefinition[] {
  return [...loadExpertPersonas(), loadModeratorPersona()];
}

export function getAvailableAgentFiles(): string[] {
  return readdirSync(AGENTS_DIR).filter((f) => f.endsWith(".md"));
}
