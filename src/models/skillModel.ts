/**
 * Project Skill model (Wave 3 §10.E).
 *
 * Thin wrapper over the adapter so the tool layer (`compile_skill`
 * workflow runner, `context_get(type='skill_*')`) doesn't reach
 * through `db.upsertSkill` etc. Keeps the surface symmetrical with
 * `projectModel` / `taskModel` / `groupModel`.
 */

import { db } from "./db.js";
import type {
  ProjectSkill,
  ProjectSkillInput,
  ProjectSkillReference,
  ProjectSkillReferenceInput,
} from "./interfaces.js";

export async function getSkillByProject(projectId: string): Promise<ProjectSkill | null> {
  return db.getSkillByProject(projectId);
}

export async function upsertSkill(input: ProjectSkillInput): Promise<ProjectSkill> {
  return db.upsertSkill(input);
}

export async function replaceSkillReferences(
  skillId: string,
  refs: ProjectSkillReferenceInput[]
): Promise<ProjectSkillReference[]> {
  return db.replaceSkillReferences(skillId, refs);
}

export async function listSkillReferences(skillId: string): Promise<ProjectSkillReference[]> {
  return db.listSkillReferences(skillId);
}

export async function getSkillReference(
  skillId: string,
  topic: string
): Promise<ProjectSkillReference | null> {
  return db.getSkillReference(skillId, topic);
}
