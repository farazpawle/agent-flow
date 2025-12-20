/**
 * Prompt loader
 * Provides functionality to load customized prompts from environment variables
 */
/**
 * Load prompt, support customization via environment variables
 * @param basePrompt Base prompt content
 * @param promptKey Key name of the prompt, used to generate environment variable name
 * @returns Final prompt content
 */
export declare function loadPrompt(basePrompt: string, promptKey: string): string;
/**
 * Generate prompt with dynamic parameters
 * @param promptTemplate Prompt template
 * @param params Dynamic parameters
 * @returns Prompt with parameters filled in
 */
export declare function generatePrompt(promptTemplate: string, params?: Record<string, any>): string;
/**
 * Load prompt from template
 * @param templatePath Relative path to template from template set root directory (e.g., 'chat/basic.md')
 * @returns Template content
 * @throws Error if template file not found
 */
export declare function loadPromptFromTemplate(templatePath: string): string;
