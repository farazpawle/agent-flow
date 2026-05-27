/**
 * Task group model (Wave 1 §10.D).
 *
 * Thin wrapper over `DatabaseAdapter`'s group methods so the tool layer
 * does not have to reach through `db.getGroup` etc. — keeps the surface
 * symmetrical with `projectModel` / `taskModel`. Also a convenient seam
 * for any future caching or invariants that should live above the
 * adapter contract.
 */

import { db } from "./db.js";
import type { TaskGroup, TaskGroupInput } from "../types/index.js";

export async function createGroup(input: TaskGroupInput): Promise<TaskGroup> {
  return db.createGroup(input);
}

export async function getGroup(id: string): Promise<TaskGroup | null> {
  return db.getGroup(id);
}

export async function listGroups(projectId: string): Promise<TaskGroup[]> {
  return db.listGroups(projectId);
}

export async function updateGroup(
  id: string,
  patch: Partial<Pick<TaskGroup, "name" | "description" | "status">>
): Promise<TaskGroup | null> {
  return db.updateGroup(id, patch);
}

export async function deleteGroup(id: string): Promise<void> {
  return db.deleteGroup(id);
}

export async function getGroupCounts(
  projectId: string
): Promise<Array<{ groupId: string | null; status: string; count: number }>> {
  return db.getGroupCounts(projectId);
}
