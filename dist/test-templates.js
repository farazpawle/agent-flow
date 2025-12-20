/**
 * Rigorous Template Verification Script
 * Use this to verify that template improvements are correctly loaded and formatted.
 * Run with: npx tsx src/test-templates.ts
 */
import { loadPromptFromTemplate } from './prompts/loader.js';
// --- Test Utilities ---
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
function checkContent(content, substring, testName) {
    if (content.includes(substring)) {
        pass(testName, 'Found expected content');
    }
    else {
        fail(testName, `Missing expected content: "${substring.substring(0, 50)}..."`);
    }
}
// --- Specific Template Tests ---
function testReflectTask() {
    log('Testing reflectTask/index.md...');
    try {
        const content = loadPromptFromTemplate('reflectTask/index.md');
        // 1. Check for Focus-Specific Guidance (The main improvement)
        checkContent(content, '## Focus-Specific Reflection Guidance', 'focus-guidance-header');
        checkContent(content, '### 🔬 Logic Mode', 'logic-mode-section');
        checkContent(content, '### 🎨 Vibe Mode', 'vibe-mode-section');
        checkContent(content, '### 🔒 Security Mode', 'security-mode-section');
        // 2. Check for critical placeholders (Regression testing)
        checkContent(content, '{summary}', 'placeholder-summary');
        checkContent(content, '{analysis}', 'placeholder-analysis');
    }
    catch (e) {
        fail('reflectTask Load', String(e));
    }
}
function testCompleteTask() {
    log('Testing completeTask/index.md...');
    try {
        const content = loadPromptFromTemplate('completeTask/index.md');
        // 1. Check for Quality Checklist
        checkContent(content, '## Final Quality Checklist', 'quality-checklist-header');
        checkContent(content, '- [ ] **Tests Passed**', 'checklist-item-tests');
        // 2. Check for Smart Tool Suggestions
        checkContent(content, '## 💡 Smart Tool Suggestions', 'smart-tools-header');
        checkContent(content, 'Desktop Commander', 'tool-suggestion-desktop-commander');
        // 3. Check for critical placeholders
        checkContent(content, '{name}', 'placeholder-name');
        checkContent(content, '{id}', 'placeholder-id');
        checkContent(content, '{completionTime}', 'placeholder-completionTime');
    }
    catch (e) {
        fail('completeTask Load', String(e));
    }
}
function testQueryTask() {
    log('Testing toolsDescription/queryTask.md...');
    try {
        const content = loadPromptFromTemplate('toolsDescription/queryTask.md');
        // 1. Check for Examples
        checkContent(content, 'Examples:', 'examples-header');
        checkContent(content, '"auth" -> Finds tasks', 'example-auth');
    }
    catch (e) {
        fail('queryTask Load', String(e));
    }
}
function testClearAllTasks() {
    log('Testing toolsDescription/clearAllTasks.md...');
    try {
        const content = loadPromptFromTemplate('toolsDescription/clearAllTasks.md');
        // 1. Check for Warning
        checkContent(content, '⚠️ WARNING', 'warning-header');
        checkContent(content, 'moves all current tasks to the \'memory\' folder', 'warning-content');
    }
    catch (e) {
        fail('clearAllTasks Load', String(e));
    }
}
function testSmartSuggestionsInOthers() {
    log('Testing Smart Suggestions in other templates...');
    try {
        // planTask
        const planContent = loadPromptFromTemplate('planTask/index.md');
        checkContent(planContent, '## 💡 Smart Tool Suggestions', 'planTask-smart-header');
        checkContent(planContent, 'perplexity_search', 'planTask-perplexity');
        checkContent(planContent, 'decisionframework', 'planTask-decisionframework');
        checkContent(planContent, '{rulesPath}', 'planTask-placeholder-rulesPath'); // Regression check
        // analyzeTask
        const analyzeContent = loadPromptFromTemplate('analyzeTask/index.md');
        checkContent(analyzeContent, '## 💡 Smart Tool Suggestions', 'analyzeTask-smart-header');
        checkContent(analyzeContent, 'mentalmodel', 'analyzeTask-mentalmodel');
        // executeTask
        const executeContent = loadPromptFromTemplate('executeTask/index.md');
        checkContent(executeContent, '## 💡 Smart Tool Suggestions', 'executeTask-smart-header');
        checkContent(executeContent, 'context7', 'executeTask-context7');
        checkContent(executeContent, 'debuggingapproach', 'executeTask-debuggingapproach');
    }
    catch (e) {
        fail('SmartSuggestions Load', String(e));
    }
}
// --- Main Runner ---
async function runTests() {
    console.log('\n' + '='.repeat(60));
    console.log('TEMPLATE QUALITY & INTEGRITY TESTS (Hard Check)');
    console.log('='.repeat(60) + '\n');
    testReflectTask();
    console.log('');
    testCompleteTask();
    console.log('');
    testQueryTask();
    console.log('');
    testClearAllTasks();
    console.log('');
    testSmartSuggestionsInOthers();
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
    console.log(`\n  Result: ${failed === 0 ? '🎉 ALL TEMPLATES VALID' : '⚠️ TEMPLATE ERRORS FOUND'}\n`);
    if (failed > 0)
        process.exit(1);
}
runTests().catch(console.error);
//# sourceMappingURL=test-templates.js.map