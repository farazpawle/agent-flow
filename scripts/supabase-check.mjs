import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');

// Load .env from root
dotenv.config({ path: path.join(REPO_ROOT, '.env') });

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY;

async function checkSupabase() {
    console.log('🔍 Checking Supabase connection and tables...');

    if (!supabaseUrl || !supabaseKey) {
        console.error('❌ Error: SUPABASE_URL and SUPABASE_SERVICE_KEY must be set in .env');
        process.exit(1);
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    const tables = ['projects', 'tasks', 'workflow_steps', 'clients'];
    let allOk = true;

    for (const table of tables) {
        const { error } = await supabase.from(table).select('id').limit(1);
        if (error) {
            console.error(`❌ Table "${table}" check failed: ${error.message}`);
            if (error.code === '42P01') {
                console.error(`   👉 Hint: Table "${table}" does not exist. Please run scripts/supabase-schema.sql in your Supabase SQL Editor.`);
            }
            allOk = false;
        } else {
            console.log(`✅ Table "${table}" is accessible.`);
        }
    }

    if (allOk) {
        console.log('✨ Supabase is correctly configured and all tables are present!');
    } else {
        console.error('⚠️ Some tables are missing. Please initialize them using scripts/supabase-schema.sql');
        process.exit(1);
    }
}

checkSupabase().catch(err => {
    console.error('❌ Unexpected error:', err);
    process.exit(1);
});
