/**
 * initProjectRules prompt generator
 * Responsible for combining templates and parameters into the final prompt
 */
import { loadPrompt, generatePrompt, loadPromptFromTemplate, } from "../loader.js";
import { getRulesFilePath } from "../../utils/pathUtils.js";
/**
 * Get the complete prompt for initProjectRules
 * @param params prompt parameters (optional)
 * @returns the generated prompt
 */
export function getInitProjectRulesPrompt(params) {
    // Use basic template
    const rulesPath = getRulesFilePath();
    const indexTemplate = loadPromptFromTemplate("initProjectRules/index.md");
    const basePrompt = generatePrompt(indexTemplate, {
        rulesPath,
    });
    // Load possible custom prompt (override or append via environment variables)
    return loadPrompt(basePrompt, "INIT_PROJECT_RULES");
}
//# sourceMappingURL=initProjectRules.js.map