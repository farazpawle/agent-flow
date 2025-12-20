import { RelatedFile } from "../types/index.js";
/**
 * Generate summary of task-related files
 *
 * This function generates summary information for files based on the provided list of RelatedFile objects without actually reading file contents.
 * This is a lightweight implementation that generates formatted summaries based only on file metadata (such as path, type, description, etc.),
 * suitable for situations where file context information is needed but access to actual file content is not required.
 *
 * @param relatedFiles List of related files - An array of RelatedFile objects containing information about file path, type, description, etc.
 * @param maxTotalLength Maximum total length of summary content - Controls the total number of characters in the generated summary to avoid excessively large return content
 * @returns An object containing two fields:
 *   - content: Detailed file information, including basic information and guidance messages for each file
 *   - summary: A concise overview of the file list, suitable for quick browsing
 */
export declare function loadTaskRelatedFiles(relatedFiles: RelatedFile[], maxTotalLength?: number): Promise<{
    content: string;
    summary: string;
}>;
