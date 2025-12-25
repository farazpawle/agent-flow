
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

/**
 * Get the remote URL for 'origin' from the current working directory or specified path.
 * Returns null if not a git repo or no remote 'origin' found.
 */
export async function getGitRemoteUrl(cwd: string): Promise<string | null> {
    try {
        const { stdout } = await execAsync('git remote get-url origin', { cwd });
        const url = stdout.trim();
        return url ? normalizeGitUrl(url) : null;
    } catch (error) {
        // Not a git repo or no origin set
        return null;
    }
}

/**
 * Normalize Git URL for comparison.
 * - Trims whitespace
 * - Removes trailing slash
 * - Removes trailing .git extension
 * - Lowercases (optional? Git URLs are case sensitive in path but domain is not. 
 *   For SAFETY/strictness, we might stick to case-insensitive for domain, but path is tricky.
 *   Plan said: "matches identities across checkouts".
 *   Plan said Simplification: "Matches: https://github.com/user/repo.git == https://github.com/user/repo"
 *   Let's stick to the plan: strip .git and whitespace. 
 *   Maybe valid to lowercase specifically for HTTP/HTTPS but NOT for ssh paths?
 *   Let's follow the plan's exact example.)
 */
export function normalizeGitUrl(url: string): string {
    if (!url) return '';
    let normalized = url.trim();

    // Remove trailing slash
    if (normalized.endsWith('/')) {
        normalized = normalized.slice(0, -1);
    }

    // Remove .git suffix
    if (normalized.endsWith('.git')) {
        normalized = normalized.slice(0, -4);
    }

    return normalized;
}
