
import { getGitRemoteUrl, normalizeGitUrl } from '../src/utils/gitUtils.js';
import path from 'path';

async function runTest() {
    console.log('--- Git Discovery Test ---');

    const urls = [
        'https://github.com/user/repo.git',
        'https://github.com/user/repo',
        '  https://github.com/user/repo.git  ',
        'https://github.com/user/repo/'
    ];

    console.log('Testing Normalization:');
    const expected = 'https://github.com/user/repo';
    for (const url of urls) {
        const norm = normalizeGitUrl(url);
        console.log(`'${url}' -> '${norm}'`);
        if (norm !== expected) {
            console.error(`FAILED: Expected '${expected}', got '${norm}'`);
        }
    }

    console.log('\nTesting Discovery (Current Repo):');
    const currentPath = process.cwd();
    console.log(`CWD: ${currentPath}`);
    const remote = await getGitRemoteUrl(currentPath);
    console.log(`Detected Remote: ${remote}`);

    if (remote) {
        console.log('SUCCESS: Git remote detected.');
    } else {
        console.warn('WARNING: No git remote detected (are you in a git repo?).');
    }

    // Test invalid path
    const invalidPath = path.join(currentPath, 'tmp-non-existent-folder');
    console.log(`\nTesting Invalid Path: ${invalidPath}`);
    const remoteInvalid = await getGitRemoteUrl(invalidPath);
    if (remoteInvalid === null) {
        console.log('SUCCESS: Correctly returned null for invalid path.');
    } else {
        console.error(`FAILED: Expected null, got '${remoteInvalid}'`);
    }
}

runTest();
