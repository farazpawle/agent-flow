import { DatabaseAdapter } from "./interfaces.js";
import { SQLiteAdapter } from "./sqliteAdapter.js";
import { SupabaseAdapter } from "./supabaseAdapter.js";
import { applyEnvironmentAliases } from "../utils/envConfig.js";
import { logger } from "../utils/logger.js";

let dbInstance: DatabaseAdapter | null = null;

function createAdapter(): DatabaseAdapter {
  applyEnvironmentAliases(process.env);

  const dbType = process.env.DB_TYPE || "sqlite";
  logger.info({ dbType }, "Selecting database adapter");

  return dbType === "supabase" ? new SupabaseAdapter() : new SQLiteAdapter();
}

export const dbFactory = {
  getDatabase: (): DatabaseAdapter => {
    if (!dbInstance) {
      dbInstance = createAdapter();
    }
    return dbInstance;
  },
};
