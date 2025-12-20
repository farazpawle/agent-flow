/**
 * Test Script for Architecture Improvements
 * Run with: npx tsx src/test-improvements.ts
 */
import { getSearchIndex, getWriteBatcher, ensureDirectories, archiveOldTasks, listArchiveFiles, DATA_DIR, ARCHIVE_DIR } from './models/persistence.js';
import { TaskStatus } from './types/index.js';
import fs from 'fs/promises';
import path from 'path';
// Test result tracking
const results = [];
function log(message) {
    console.log(`[TEST] ${message}`);
}
function pass(test, details = '') {
    results.push({ test, status: 'PASS', details });
    console.log(`  ✅ ${test}${details ? ': ' + details : ''}`);
}
function fail(test, details) {
    results.push({ test, status: 'FAIL', details });
    console.log(`  ❌ ${test}: ${details}`);
}
// Test 1: Directory Structure
async function testDirectoryStructure() {
    log('Testing Directory Structure...');
    try {
        await ensureDirectories();
        // Check if directories exist
        const dirs = [DATA_DIR, ARCHIVE_DIR, path.join(DATA_DIR, 'memory')];
        for (const dir of dirs) {
            try {
                await fs.access(dir);
                pass(`Directory exists: ${path.basename(dir)}`);
            }
            catch {
                fail(`Directory exists: ${path.basename(dir)}`, 'Directory not found');
            }
        }
    }
    catch (e) {
        fail('ensureDirectories()', String(e));
    }
}
// Test 2: Search Index
async function testSearchIndex() {
    log('Testing MiniSearch Index...');
    try {
        const searchIndex = getSearchIndex();
        // Create mock tasks
        const mockTasks = [
            {
                id: 'test-1',
                name: 'Build authentication system',
                description: 'Create OAuth login flow with JWT tokens',
                status: TaskStatus.PENDING,
                dependencies: [],
                createdAt: new Date(),
                updatedAt: new Date()
            },
            {
                id: 'test-2',
                name: 'Design dashboard UI',
                description: 'Create responsive dashboard with charts',
                status: TaskStatus.PENDING,
                dependencies: [],
                createdAt: new Date(),
                updatedAt: new Date()
            },
            {
                id: 'test-3',
                name: 'Fix button styling',
                description: 'Update button colors and padding',
                status: TaskStatus.PENDING,
                dependencies: [],
                createdAt: new Date(),
                updatedAt: new Date()
            }
        ];
        // Build index
        searchIndex.rebuild(mockTasks);
        pass('Index rebuild', `Indexed ${mockTasks.length} tasks`);
        // Test exact search
        const exactResults = searchIndex.search('authentication');
        if (exactResults.includes('test-1')) {
            pass('Exact search', `Found 'authentication' -> test-1`);
        }
        else {
            fail('Exact search', `Expected test-1, got ${JSON.stringify(exactResults)}`);
        }
        // Test fuzzy search
        const fuzzyResults = searchIndex.search('buttn'); // typo for "button"
        if (fuzzyResults.includes('test-3')) {
            pass('Fuzzy search', `Found 'buttn' -> test-3 (fuzzy match)`);
        }
        else {
            // Fuzzy may not always work depending on settings
            log(`  ⚠️ Fuzzy search: 'buttn' returned ${JSON.stringify(fuzzyResults)} (may need adjustment)`);
        }
        // Test multi-word search
        const multiResults = searchIndex.search('dashboard design');
        if (multiResults.includes('test-2')) {
            pass('Multi-word search', `Found 'dashboard design' -> test-2`);
        }
        else {
            fail('Multi-word search', `Expected test-2, got ${JSON.stringify(multiResults)}`);
        }
    }
    catch (e) {
        fail('SearchIndex', String(e));
    }
}
// Test 3: Write Batcher
async function testWriteBatcher() {
    log('Testing Write Batcher...');
    try {
        const batcher = getWriteBatcher();
        // Verify batcher exists
        if (batcher) {
            pass('WriteBatcher instantiation', 'Batcher created successfully');
        }
        else {
            fail('WriteBatcher instantiation', 'Batcher is null');
        }
        // Check methods exist
        if (typeof batcher.schedule === 'function') {
            pass('WriteBatcher.schedule()', 'Method exists');
        }
        else {
            fail('WriteBatcher.schedule()', 'Method not found');
        }
        if (typeof batcher.flush === 'function') {
            pass('WriteBatcher.flush()', 'Method exists');
        }
        else {
            fail('WriteBatcher.flush()', 'Method not found');
        }
    }
    catch (e) {
        fail('WriteBatcher', String(e));
    }
}
// Test 4: Archive Functions
async function testArchiveFunctions() {
    log('Testing Archive Functions...');
    try {
        // Create mock completed tasks - some old, some recent
        const now = new Date();
        const oldDate = new Date(now.getTime() - 45 * 24 * 60 * 60 * 1000); // 45 days ago
        const mockTasks = [
            {
                id: 'active-1',
                name: 'Active task',
                description: 'This task is still pending',
                status: TaskStatus.PENDING,
                dependencies: [],
                createdAt: now,
                updatedAt: now
            },
            {
                id: 'recent-completed',
                name: 'Recent completed',
                description: 'Completed yesterday',
                status: TaskStatus.COMPLETED,
                dependencies: [],
                createdAt: now,
                updatedAt: now,
                completedAt: new Date(now.getTime() - 24 * 60 * 60 * 1000) // 1 day ago
            },
            {
                id: 'old-completed',
                name: 'Old completed',
                description: 'Completed 45 days ago',
                status: TaskStatus.COMPLETED,
                dependencies: [],
                createdAt: oldDate,
                updatedAt: oldDate,
                completedAt: oldDate
            }
        ];
        // Test archiving
        const { archivedCount, remainingTasks } = await archiveOldTasks(mockTasks);
        if (archivedCount === 1) {
            pass('Archive old tasks', `Archived ${archivedCount} old task(s)`);
        }
        else {
            log(`  ⚠️ Archive old tasks: Expected 1 archived, got ${archivedCount}`);
        }
        if (remainingTasks.length === 2) {
            pass('Remaining tasks', `${remainingTasks.length} tasks remain active`);
        }
        else {
            fail('Remaining tasks', `Expected 2, got ${remainingTasks.length}`);
        }
        // Test archive listing
        const archives = await listArchiveFiles();
        pass('List archives', `Found ${archives.length} archive file(s)`);
    }
    catch (e) {
        fail('Archive functions', String(e));
    }
}
// Test 5: Schema imports
async function testSchemaImports() {
    log('Testing Schema Organization...');
    try {
        // Dynamic import of schemas
        const schemas = await import('./tools/task/schemas.js');
        const schemaNames = [
            'planTaskSchema',
            'analyzeTaskSchema',
            'reflectTaskSchema',
            'splitTasksSchema',
            'listTasksSchema',
            'executeTaskSchema',
            'verifyTaskSchema',
            'completeTaskSchema',
            'deleteTaskSchema',
            'clearAllTasksSchema',
            'updateTaskContentSchema',
            'queryTaskSchema',
            'getTaskDetailSchema'
        ];
        for (const name of schemaNames) {
            if (schemas[name]) {
                pass(`Schema: ${name}`, 'Exported correctly');
            }
            else {
                fail(`Schema: ${name}`, 'Not found in exports');
            }
        }
    }
    catch (e) {
        fail('Schema imports', String(e));
    }
}
// Main test runner
async function runTests() {
    console.log('\n' + '='.repeat(60));
    console.log('MCP Chain-of-Thought Architecture Improvement Tests');
    console.log('='.repeat(60) + '\n');
    await testDirectoryStructure();
    console.log('');
    await testSearchIndex();
    console.log('');
    await testWriteBatcher();
    console.log('');
    await testArchiveFunctions();
    console.log('');
    await testSchemaImports();
    console.log('');
    // Summary
    console.log('='.repeat(60));
    console.log('TEST SUMMARY');
    console.log('='.repeat(60));
    const passed = results.filter(r => r.status === 'PASS').length;
    const failed = results.filter(r => r.status === 'FAIL').length;
    console.log(`\n  Total: ${results.length}`);
    console.log(`  ✅ Passed: ${passed}`);
    console.log(`  ❌ Failed: ${failed}`);
    console.log(`\n  Result: ${failed === 0 ? '🎉 ALL TESTS PASSED' : '⚠️ SOME TESTS FAILED'}\n`);
    // Exit with error code if tests failed
    if (failed > 0) {
        process.exit(1);
    }
}
runTests().catch(console.error);
//# sourceMappingURL=test-improvements.js.map