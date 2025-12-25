import { DatabaseAdapter } from "./interfaces.js";
import { SQLiteAdapter } from "./sqliteAdapter.js";
import { SupabaseAdapter } from "./supabaseAdapter.js";

let dbInstance: DatabaseAdapter | null = null;

export const dbFactory = {
    getDatabase: (): DatabaseAdapter => {
        if (dbInstance) return dbInstance;

        const dbType = process.env.DB_TYPE || "sqlite";

        console.log(`(AgentFlow) Selected Database Type: ${dbType}`);

        if (dbType === "supabase") {
            dbInstance = new SupabaseAdapter();
        } else {
            dbInstance = new SQLiteAdapter();
        }
        return dbInstance!;
    }
};
