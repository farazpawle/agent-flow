/**
 * Get rules file path
 * @returns Complete path to the rules file
 */
export declare function getRulesFilePath(): string;
/**
 * Ensure rules file exists
 * If the file doesn't exist, it will try to copy from root directory or create an empty file
 */
export declare function ensureRulesFileExists(): Promise<void>;
