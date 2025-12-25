import { z } from "zod";
import { planIdeaSchema, analyzeIdeaSchema, reflectIdeaSchema } from "./schemas.js";
export declare function planIdea({ description, requirements, projectId, focus, }: z.infer<typeof planIdeaSchema>): Promise<{
    content: {
        type: "text";
        text: string;
    }[];
    isError: boolean;
} | {
    content: {
        type: "text";
        text: string;
    }[];
    isError?: undefined;
}>;
export declare function analyzeIdea({ inputStepId, projectId: explicitProjectId, }: z.infer<typeof analyzeIdeaSchema>): Promise<{
    content: {
        type: "text";
        text: string;
    }[];
    isError: boolean;
} | {
    content: {
        type: "text";
        text: string;
    }[];
    isError?: undefined;
}>;
export declare function reflectIdea({ inputStepId, analysis, projectId: explicitProjectId, }: z.infer<typeof reflectIdeaSchema>): Promise<{
    content: {
        type: "text";
        text: string;
    }[];
    isError: boolean;
} | {
    content: {
        type: "text";
        text: string;
    }[];
    isError?: undefined;
}>;
