import { z } from "zod";
import { planTaskSchema, analyzeTaskSchema, reflectTaskSchema } from "./schemas.js";
export declare function planTask({ description, requirements, existingTasksReference, }: z.infer<typeof planTaskSchema>): Promise<{
    content: {
        type: "text";
        text: string;
    }[];
}>;
export declare function analyzeTask({ summary, initialConcept, previousAnalysis, }: z.infer<typeof analyzeTaskSchema>): Promise<{
    content: {
        type: "text";
        text: string;
    }[];
}>;
export declare function reflectTask({ summary, analysis, }: z.infer<typeof reflectTaskSchema>): Promise<{
    content: {
        type: "text";
        text: string;
    }[];
}>;
