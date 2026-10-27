// Types for scripts/content.mjs, used by vite.config.ts.
export function readJson(rel: string): any;
export function loadContent(): { participants: any; trainers: any; rubric: any };
export function contentVersion(file: any): string;
export function publicQuestions(file: any): unknown;
export function publicRubric(file: any): unknown;
export function validateQuestions(file: any, audience: string): void;
export function validateRubric(file: any): void;
