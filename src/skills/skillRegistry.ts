import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { AgentConfig, SkillDefinition } from "../types.js";

interface SkillWithContent extends SkillDefinition {
  content: string;
}

export class SkillRegistry {
  private readonly byId: Map<string, SkillWithContent>;

  private constructor(skills: SkillWithContent[]) {
    this.byId = new Map(skills.map((skill) => [skill.id, skill]));
  }

  static async load(projectRoot: string): Promise<SkillRegistry> {
    const roots = await discoverSkillRoots(projectRoot);
    const skills: SkillWithContent[] = [];
    const seenIds = new Set<string>();

    for (const root of roots) {
      const skillFiles = await findSkillFiles(root.path);
      for (const skillFile of skillFiles) {
        const skill = await readSkillDefinition(skillFile, root.source);
        if (!skill || seenIds.has(skill.id)) {
          continue;
        }

        seenIds.add(skill.id);
        skills.push(skill);
      }
    }

    skills.sort((left, right) => left.id.localeCompare(right.id));
    return new SkillRegistry(skills);
  }

  getAll(): SkillDefinition[] {
    return [...this.byId.values()].map(stripContent);
  }

  getById(id: string): SkillDefinition | undefined {
    const skill = this.byId.get(id);
    return skill ? stripContent(skill) : undefined;
  }

  getAllowedForAgent(agent: AgentConfig): SkillDefinition[] {
    if (agent.allowedSkills.includes("*")) {
      return this.getAll();
    }

    return agent.allowedSkills
      .map((skillId) => this.byId.get(skillId))
      .filter((skill): skill is SkillWithContent => Boolean(skill))
      .map(stripContent);
  }

  resolveForAgent(agent: AgentConfig, requestedSkillIds: string[]): SkillDefinition[] {
    const requested = uniqueStrings(requestedSkillIds);
    if (requested.length === 0) {
      return [];
    }

    if (requested.length > 3) {
      throw new Error("Solo permito hasta 3 habilidades por ejecucion.");
    }
    for (const skillId of requested) {
      const skill = this.byId.get(skillId);
      if (!skill) {
        throw new Error(`La habilidad "${skillId}" no esta instalada localmente.`);
      }

      if (!this.isAllowedForAgent(agent, skillId)) {
        throw new Error(`La habilidad "${skillId}" no esta permitida para el agente "${agent.id}".`);
      }
    }

    return requested.map((skillId) => stripContent(this.byId.get(skillId)!));
  }

  getContent(skillId: string): string | undefined {
    return this.byId.get(skillId)?.content;
  }

  private isAllowedForAgent(agent: AgentConfig, skillId: string): boolean {
    return agent.allowedSkills.includes("*") || agent.allowedSkills.includes(skillId);
  }
}

async function discoverSkillRoots(
  projectRoot: string
): Promise<Array<{ path: string; source: SkillDefinition["source"] }>> {
  const roots: Array<{ path: string; source: SkillDefinition["source"] }> = [];
  const repoSkills = path.resolve(projectRoot, "skills");
  if (await exists(repoSkills)) {
    roots.push({ path: repoSkills, source: "repo" });
  }

  const codexHome = process.env.CODEX_HOME || path.join(os.homedir(), ".codex");
  const codexSkills = path.resolve(codexHome, "skills");
  if (await exists(codexSkills)) {
    roots.push({ path: codexSkills, source: "codex-home" });
  }

  const pluginSkills = path.resolve(codexHome, ".tmp", "plugins", "plugins");
  if (await exists(pluginSkills)) {
    const pluginEntries = await fs.readdir(pluginSkills, { withFileTypes: true });
    for (const entry of pluginEntries) {
      if (!entry.isDirectory()) {
        continue;
      }

      const skillDir = path.join(pluginSkills, entry.name, "skills");
      if (await exists(skillDir)) {
        roots.push({ path: skillDir, source: "plugin" });
      }
    }
  }

  return roots;
}

async function findSkillFiles(rootDir: string): Promise<string[]> {
  const found: string[] = [];

  async function walk(currentDir: string): Promise<void> {
    const entries = await fs.readdir(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
        continue;
      }

      if (entry.isFile() && entry.name === "SKILL.md") {
        found.push(fullPath);
      }
    }
  }

  await walk(rootDir);
  return found;
}

async function readSkillDefinition(
  skillFile: string,
  source: SkillDefinition["source"]
): Promise<SkillWithContent | undefined> {
  const content = await fs.readFile(skillFile, "utf8");
  const parsed = parseFrontmatter(content);
  const skillDir = path.dirname(skillFile);
  const id = path.basename(skillDir);

  if (!id) {
    return undefined;
  }

  return {
    id,
    name: parsed.name || id,
    description: parsed.description,
    path: skillFile,
    source,
    runtimeSupport: detectRuntimeSupport(id),
    content
  };
}

function parseFrontmatter(content: string): { name?: string; description?: string } {
  const lines = content.split(/\r?\n/);
  if (lines[0]?.trim() !== "---") {
    return {};
  }

  const result: { name?: string; description?: string } = {};
  for (let index = 1; index < lines.length; index += 1) {
    const line = lines[index].trim();
    if (line === "---") {
      break;
    }

    const separatorIndex = line.indexOf(":");
    if (separatorIndex === -1) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim();
    const value = line.slice(separatorIndex + 1).trim();
    if (key === "name") {
      result.name = stripQuotes(value);
    }
    if (key === "description") {
      result.description = stripQuotes(value);
    }
  }

  return result;
}

function stripQuotes(value: string): string {
  return value.replace(/^['"]|['"]$/g, "");
}

function stripContent(skill: SkillWithContent): SkillDefinition {
  return {
    id: skill.id,
    name: skill.name,
    description: skill.description,
    path: skill.path,
    source: skill.source,
    runtimeSupport: skill.runtimeSupport
  };
}

function detectRuntimeSupport(skillId: string): SkillDefinition["runtimeSupport"] {
  if (
    /^gmail(?:-|$)/i.test(skillId) ||
    /^google-(?:drive|docs|sheets|slides|calendar)(?:-|$)/i.test(skillId)
  ) {
    return "desktop-connector";
  }

  return "exec";
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

async function exists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}
