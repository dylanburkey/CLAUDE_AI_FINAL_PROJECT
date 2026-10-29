import type { AgentDefinition } from '@anthropic-ai/claude-agent-sdk';
import { REFACTORING_SUGGESTER_PROMPT } from '../prompts/index.js';

export const REFACTORING_SUGGESTER_NAME = 'refactoring-suggester';
export const REFACTORING_SUGGESTER_VERSION = '1.0.0';

/**
 * Suggests modernization and pattern improvements with before/after examples
 */
export const refactoringSuggester: AgentDefinition = {
  description: 'Refactoring specialist. Use to suggest modernization, simplification, and design pattern improvements for a file, with before/after code and impact assessment.',
  prompt: REFACTORING_SUGGESTER_PROMPT,
  tools: ['Read', 'Skill'],
  model: 'inherit'
};
