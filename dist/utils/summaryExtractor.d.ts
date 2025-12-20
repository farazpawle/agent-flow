/**
 * Summary Extraction Tool: Extract key information from conversation content
 *
 * This module provides functionality to extract key information from complete conversations, using multiple strategies to identify important content:
 * 1. Keyword matching: Identify sentences containing specific keywords
 * 2. Sentence importance scoring: Evaluate sentence importance based on factors such as position, length, etc.
 * 3. Contextual relevance: Consider logical connections between sentences
 */
/**
 * Extract a brief summary from text
 * @param text Text from which to extract the summary
 * @param maxLength Maximum length of the summary
 * @returns Extracted summary text
 */
export declare function extractSummary(text: string, maxLength?: number): string;
/**
 * Generate task completion summary
 * @param taskName Task name
 * @param taskDescription Task description
 * @param completionDetails Completion details (optional)
 * @returns Generated task summary
 */
export declare function generateTaskSummary(taskName: string, taskDescription: string, completionDetails?: string): string;
/**
 * Extract a brief title from specified content
 *
 * @param content Content from which to extract the title
 * @param maxLength Maximum length of the title
 * @returns Extracted title
 */
export declare function extractTitle(content: string, maxLength?: number): string;
/**
 * Intelligent extract summary based on conversation context
 *
 * @param messages List of conversation messages, each containing role and content
 * @param maxLength Maximum length of the summary
 * @returns Extracted summary
 */
export declare function extractSummaryFromConversation(messages: Array<{
    role: string;
    content: string;
}>, maxLength?: number): string;
