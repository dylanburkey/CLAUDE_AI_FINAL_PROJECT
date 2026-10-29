import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';

/**
 * Structured output schemas for subagent analysis results
 * Uses Zod for runtime validation and converts to JSON Schema for SDK
 */

/**
 * Code Quality Analyzer output: severity-leveled issues and a 0-100 score
 */
export const CodeQualityResultSchema = z.object({
  file: z.string(),
  issues: z.array(z.object({
    line: z.number(),
    severity: z.enum(['critical', 'high', 'medium', 'low', 'info']),
    category: z.enum([
      'security',
      'performance',
      'maintainability',
      'style',
      'bug-risk',
      'best-practice'
    ]),
    description: z.string(),
    suggestion: z.string()
  })),
  overallScore: z.number().min(0).max(100),
  summary: z.string()
});

/**
 * Test Coverage Analyzer output: tests found, prioritized untested paths, and a coverage estimate
 */
export const TestCoverageResultSchema = z.object({
  file: z.string(),
  hasTests: z.boolean(),
  testFiles: z.array(z.string()),
  untestedPaths: z.array(z.object({
    type: z.enum(['function', 'class', 'branch', 'edge-case']),
    location: z.string(),
    priority: z.enum(['critical', 'high', 'medium', 'low']),
    reasoning: z.string(),
    suggestedTest: z.string()
  })),
  coverageEstimate: z.number().min(0).max(100),
  summary: z.string()
});

/**
 * Refactoring Suggester output: suggestions with before/after code and impact
 */
export const RefactoringSuggestionSchema = z.object({
  file: z.string(),
  suggestions: z.array(z.object({
    type: z.enum([
      'extract-function',
      'rename',
      'modernize',
      'simplify',
      'pattern-improvement'
    ]),
    location: z.string(),
    impact: z.enum(['low', 'medium', 'high']),
    description: z.string(),
    before: z.string(),
    after: z.string(),
    benefits: z.string()
  })),
  summary: z.string()
});

/** Validated code-quality-analyzer result */
export type CodeQualityResult = z.infer<typeof CodeQualityResultSchema>;
/** Validated test-coverage-analyzer result */
export type TestCoverageResult = z.infer<typeof TestCoverageResultSchema>;
/** Validated refactoring-suggester result */
export type RefactoringSuggestion = z.infer<typeof RefactoringSuggestionSchema>;

/** Plain JSON Schema object */
type JsonSchema = Record<string, unknown>;

/**
 * Convert a Zod schema to JSON Schema with all $refs inlined at the root
 */
const toJsonSchema = (schema: z.ZodTypeAny): JsonSchema =>
  (zodToJsonSchema as (s: unknown, options?: unknown) => unknown)(
    schema,
    { $refStrategy: 'root' }
  ) as JsonSchema;

/**
 * Convert Zod schemas to JSON Schema for SDK structured outputs
 * Per SDK docs: https://platform.claude.com/docs/en/agent-sdk/structured-outputs
 * Use $refStrategy: 'root' to properly inline all $ref definitions
 */
export const CodeQualityResultJSONSchema: JsonSchema = toJsonSchema(CodeQualityResultSchema);
/** JSON Schema for TestCoverageResultSchema */
export const TestCoverageResultJSONSchema: JsonSchema = toJsonSchema(TestCoverageResultSchema);
/** JSON Schema for RefactoringSuggestionSchema */
export const RefactoringSuggestionJSONSchema: JsonSchema = toJsonSchema(RefactoringSuggestionSchema);
