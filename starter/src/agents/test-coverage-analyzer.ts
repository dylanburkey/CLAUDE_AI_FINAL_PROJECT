/**
 * test-coverage-analyzer subagent definition
 */
import type { AgentDefinition } from '@anthropic-ai/claude-agent-sdk';
import { TEST_COVERAGE_ANALYZER_PROMPT } from '../prompts/index.js';
import { githubTools } from '../config/mcp.config.js';

/** Subagent name the orchestrator passes to the Task tool */
export const TEST_COVERAGE_ANALYZER_NAME = 'test-coverage-analyzer';
/** Subagent version recorded in report metadata */
export const TEST_COVERAGE_ANALYZER_VERSION = '1.0.0';

/**
 * Identifies untested code paths and suggests prioritized tests
 * Reasons step by step; the orchestrator query enables extended thinking
 */
export const testCoverageAnalyzer: AgentDefinition = {
  description: 'Test coverage specialist. Use to find existing tests for a file, identify untested functions, branches, and edge cases, and suggest prioritized test cases.',
  prompt: TEST_COVERAGE_ANALYZER_PROMPT,
  tools: ['Read', 'Grep', 'Glob', githubTools.getFileContents, githubTools.searchCode],
  model: 'inherit'
};
