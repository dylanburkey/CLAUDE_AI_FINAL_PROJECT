/**
 * Subagent exports
 */
import type { AgentDefinition } from '@anthropic-ai/claude-agent-sdk';
import {
  codeQualityAnalyzer,
  CODE_QUALITY_ANALYZER_NAME,
  CODE_QUALITY_ANALYZER_VERSION
} from './code-quality-analyzer.js';
import {
  testCoverageAnalyzer,
  TEST_COVERAGE_ANALYZER_NAME,
  TEST_COVERAGE_ANALYZER_VERSION
} from './test-coverage-analyzer.js';
import {
  refactoringSuggester,
  REFACTORING_SUGGESTER_NAME,
  REFACTORING_SUGGESTER_VERSION
} from './refactoring-suggester.js';

export { codeQualityAnalyzer, testCoverageAnalyzer, refactoringSuggester };

/**
 * All subagents keyed by the name the orchestrator uses with the Task tool
 */
export const subagents: Record<string, AgentDefinition> = {
  [CODE_QUALITY_ANALYZER_NAME]: codeQualityAnalyzer,
  [TEST_COVERAGE_ANALYZER_NAME]: testCoverageAnalyzer,
  [REFACTORING_SUGGESTER_NAME]: refactoringSuggester
};

/**
 * Subagent versions keyed by name, recorded in report metadata
 */
export const agentVersions: Record<string, string> = {
  [CODE_QUALITY_ANALYZER_NAME]: CODE_QUALITY_ANALYZER_VERSION,
  [TEST_COVERAGE_ANALYZER_NAME]: TEST_COVERAGE_ANALYZER_VERSION,
  [REFACTORING_SUGGESTER_NAME]: REFACTORING_SUGGESTER_VERSION
};

/**
 * Every tool any subagent needs; the parent query must allow these too
 */
export const subagentTools: string[] = [
  ...new Set(Object.values(subagents).flatMap(agent => agent.tools ?? []))
];
