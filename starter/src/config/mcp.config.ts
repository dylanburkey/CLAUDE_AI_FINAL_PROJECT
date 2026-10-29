import type { McpStdioServerConfig } from '@anthropic-ai/claude-agent-sdk';

/**
 * Model Context Protocol (MCP) server configurations
 *
 * Required MCP Servers:
 * 1. GitHub - For PR/repo operations
 * 2. ESLint - For code linting and style analysis
 *
 * Documentation:
 * - MCP Protocol: https://modelcontextprotocol.io
 * - GitHub MCP: https://github.com/github/github-mcp-server
 * - ESLint MCP: https://eslint.org/docs/latest/use/mcp
 */

export const mcpServersConfig = {
  /**
   * GitHub MCP Server
   * Provides tools for GitHub API operations
   *
   * Note: GITHUB_TOKEN is optional (recommended for private repos and higher rate limits).
   * The GitHub MCP server expects GITHUB_PERSONAL_ACCESS_TOKEN as the env var name.
   * We map our GITHUB_TOKEN from .env to this expected name.
   */
  github: {
    type: 'stdio' as const,
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-github'],
    env: { GITHUB_PERSONAL_ACCESS_TOKEN: process.env.GITHUB_TOKEN || '' }
  },

  /**
   * ESLint MCP Server
   * Provides tools for linting and code quality analysis
   * Lints against eslint.config.js in PROJECT_ROOT
   */
  eslint: {
    type: 'stdio' as const,
    command: 'npx',
    args: ['-y', '@eslint/mcp@latest'],
    env: {}
  }
} satisfies Record<string, McpStdioServerConfig>;

/**
 * MCP tool names as exposed to agents (mcp__<server>__<tool>)
 */
export const githubTools = {
  getFileContents: 'mcp__github__get_file_contents',
  searchCode: 'mcp__github__search_code'
} as const;

export const eslintTools = {
  lintFiles: 'mcp__eslint__lint-files'
} as const;
