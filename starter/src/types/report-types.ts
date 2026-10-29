/**
 * Schemas and types for the final review report
 */
import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import {
  CodeQualityResultSchema,
  TestCoverageResultSchema,
  RefactoringSuggestionSchema
} from './analysis-results.js';

/**
 * Per-file review produced by the three subagents
 */
export const FileReviewSchema = z.object({
  file: z.string(),
  codeQuality: CodeQualityResultSchema,
  testCoverage: TestCoverageResultSchema,
  refactorings: RefactoringSuggestionSchema
});

/**
 * Complete Review Report Schema
 * Aggregates all subagent results into a unified report
 */
export const ReviewReportSchema = z.object({
  pullRequest: z.object({
    owner: z.string(),
    repo: z.string(),
    number: z.number()
  }),
  fileReviews: z.array(FileReviewSchema),
  summary: z.object({
    totalFiles: z.number(),
    overallScore: z.number(),
    criticalIssues: z.number(),
    highPriorityTests: z.number(),
    refactoringOpportunities: z.number()
  }),
  recommendations: z.array(z.object({
    priority: z.enum(['critical', 'high', 'medium', 'low']),
    category: z.string(),
    description: z.string(),
    files: z.array(z.string())
  })),
  metadata: z.object({
    analyzedAt: z.string(),
    duration: z.number(),
    agentVersions: z.record(z.string())
  })
});

/**
 * TypeScript type inferred from Zod schema
 */
export type ReviewReport = z.infer<typeof ReviewReportSchema>;
/** Validated per-file review */
export type FileReview = z.infer<typeof FileReviewSchema>;

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
 * JSON Schema for SDK structured outputs
 * Per SDK docs: https://platform.claude.com/docs/en/agent-sdk/structured-outputs
 * Use $refStrategy: 'root' to properly inline all $ref definitions
 */
const rawSchema: JsonSchema = toJsonSchema(ReviewReportSchema);

// Extract the actual schema - zodToJsonSchema may wrap it with extra properties
/** JSON Schema for the complete review report */
export const ReviewReportJSONSchema = rawSchema;

// Strip the $schema key, which the structured output API doesn't need
const { $schema: _fileReviewSchemaUri, ...fileReviewJSONSchema } = toJsonSchema(FileReviewSchema);
/** JSON Schema the orchestrator agent must satisfy for each file's structured output */
export const FileReviewJSONSchema: JsonSchema = fileReviewJSONSchema;
