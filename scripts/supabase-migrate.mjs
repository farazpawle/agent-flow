import sqlite3 from 'sqlite3';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');

// Load .env
dotenv.config({ path: path.join(REPO_ROOT, '.env') });

const DATA_DIR = process.env.DATA_DIR || path.join(REPO_ROOT, 'data');
const sqlitePath = path.join(DATA_DIR, 'agent-flow.db');
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY;

async function migrate() {
    console.log('🔄 Starting migration from SQLite to Supabase...');

    if (!fs.existsSync(sqlitePath)) {
        console.error(`❌ SQLite database not found at ${sqlitePath}`);
        return;
    }

    if (!supabaseUrl || !supabaseKey) {
        console.error('❌ Supabase credentials missing in .env');
        return;
    }

    const db = new sqlite3.Database(sqlitePath);
    const supabase = createClient(supabaseUrl, supabaseKey);

    const tables = ['projects', 'tasks', 'workflow_steps', 'clients'];

    for (const table of tables) {
        console.log(`📦 Migrating table: ${table}...`);

        const rows = await new Promise((resolve, reject) => {
            db.all(`SELECT * FROM ${table}`, (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
            });
        });

        if (rows.length === 0) {
            console.log(`  - No rows in ${table}, skipping.`);
            continue;
        }

        // Handle JSON columns and field mapping
        const mappedRows = rows.map(row => {
            const mapped = { ...row };
            // In SQLite we use TEXT for JSON, in Supabase we use JSONB
            if (table === 'projects' && row.tech_stack) mapped.tech_stack = JSON.parse(row.tech_stack);
            if (table === 'tasks' && row.content) mapped.content = JSON.parse(row.content);
            if (table === 'tasks' && row.execution_order === undefined) mapped.execution_order = 0;
            return mapped;
        });

        const { error } = await supabase.from(table).upsert(mappedRows);

        if (error) {
            console.error(`  ❌ Error migrating ${table}:`, error.message);
        } else {
            console.log(`  ✅ Successfully migrated ${rows.length} rows to ${table}.`);
        }
    }

    db.close();
    console.log('🎉 Migration complete!');
}

migrate().catch(console.error);
