import type { AgentDefinition } from '@anthropic-ai/claude-agent-sdk';
import { CODE_QUALITY_ANALYZER_PROMPT } from '../prompts/index.js';
import { eslintTools } from '../config/mcp.config.js';

export const CODE_QUALITY_ANALYZER_NAME = 'code-quality-analyzer';
export const CODE_QUALITY_ANALYZER_VERSION = '1.0.0';

/**
 * Finds security, performance, and maintainability issues
 * Uses Claude Skills for language-specific guidance and ESLint MCP for JS linting
 */
export const codeQualityAnalyzer: AgentDefinition = {
  description: 'Code quality specialist. Use to find security vulnerabilities, performance problems, and maintainability issues in a file, with severity-leveled feedback.',
  prompt: CODE_QUALITY_ANALYZER_PROMPT,
  tools: ['Read', 'Grep', 'Glob', 'Skill', eslintTools.lintFiles],
  model: 'inherit'
};
