/**
 * Rigorous Template Caching Verification
 * Verifies that caching is active by checking for "stale" content after file update.
 * Run with: npx tsx src/test-caching.ts
 */

import { loadPromptFromTemplate } from './prompts/loader.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Helper for logging
const results: { test: string; status: 'PASS' | 'FAIL'; details: string }[] = [];

function pass(test: string, details: string = '') {
    results.push({ test, status: 'PASS', details });
    console.log(`  ✅ ${test}${details ? ': ' + details : ''}`);
}

function fail(test: string, details: string) {
    results.push({ test, status: 'FAIL', details });
    console.log(`  ❌ ${test}: ${details}`);
}

async function runTests() {
    console.log('\n' + '='.repeat(60));
    console.log('TEMPLATE CACHING TESTS (Stale Cache verification)');
    console.log('='.repeat(60) + '\n');

    const templateDir = path.join(__dirname, 'prompts', 'templates_en');
    const testFileName = 'test_cache_verify.md';
    const testFilePath = path.join(templateDir, testFileName);

    try {
        // 1. Setup: Create a test template
        console.log(`[SETUP] Creating test template at ${testFilePath}`);
        fs.writeFileSync(testFilePath, 'VERSION 1: Initial Content');

        // 2. First Load (Cold)
        console.log('[ACTION] First load (Cold)...');
        const start1 = process.hrtime();
        const content1 = loadPromptFromTemplate(testFileName);
        const end1 = process.hrtime(start1);
        const time1 = (end1[0] * 1e9 + end1[1]) / 1e6; // ms

        if (content1 === 'VERSION 1: Initial Content') {
            pass('First Load', `Correct content loaded in ${time1.toFixed(3)}ms`);
        } else {
            fail('First Load', `Expected 'VERSION 1...', got '${content1}'`);
        }

        // 3. Modify File (Simulate update)
        // If caching is working, the loader should ignore this update and return cached Version 1
        console.log('[ACTION] Modifying file on disk to "VERSION 2"...');
        fs.writeFileSync(testFilePath, 'VERSION 2: Updated Content');

        // 4. Second Load (Warm)
        console.log('[ACTION] Second load (Warm)...');
        const start2 = process.hrtime();
        const content2 = loadPromptFromTemplate(testFileName);
        const end2 = process.hrtime(start2);
        const time2 = (end2[0] * 1e9 + end2[1]) / 1e6; // ms

        // 5. Verify Caching Behavior
        // We EXPECT content2 to still be VERSION 1 because it's cached!
        if (content2 === 'VERSION 1: Initial Content') {
            pass('Cache Hit Verification', 'Stale content returned (PROOF: Cache is active)');
        } else if (content2 === 'VERSION 2: Updated Content') {
            fail('Cache Hit Verification', 'New content returned (FAIL: Cache NOT active)');
        } else {
            fail('Cache Hit Verification', `Unexpected content: '${content2}'`);
        }

        // Performance check (Warm should be faster than Cold, though noisy on single run)
        if (time2 < time1) {
            pass('Performance', `Warm load (${time2.toFixed(3)}ms) < Cold load (${time1.toFixed(3)}ms)`);
        } else {
            console.log(`  ℹ️ Performance: Warm (${time2.toFixed(3)}ms) vs Cold (${time1.toFixed(3)}ms) - might be noise`);
        }

    } catch (e) {
        fail('Test Execution', String(e));
    } finally {
        // Cleanup
        try {
            if (fs.existsSync(testFilePath)) {
                fs.unlinkSync(testFilePath);
                console.log(`\n[CLEANUP] Deleted test file: ${testFilePath}`);
            }
        } catch (e) {
            console.error('Cleanup failed:', e);
        }
    }

    // Summary
    console.log('='.repeat(60));
    console.log('TEST SUMMARY');
    console.log('='.repeat(60));

    const passed = results.filter(r => r.status === 'PASS').length;
    const failed = results.filter(r => r.status === 'FAIL').length;

    console.log(`\n  Total: ${results.length}`);
    console.log(`  ✅ Passed: ${passed}`);
    console.log(`  ❌ Failed: ${failed}`);
    console.log(`\n  Result: ${failed === 0 ? '🎉 CACHING VERIFIED' : '⚠️ CACHING FAILED'}\n`);

    if (failed > 0) process.exit(1);
}

runTests().catch(console.error);
