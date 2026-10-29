/**
 * CLI entry point
 * Validates arguments and environment, runs a review, and writes Markdown/HTML/JSON reports
 */

// Load environment variables before any module reads process.env at import time
import 'dotenv/config';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { CodeReviewOrchestrator } from './orchestrator.js';
import { ReportGenerator } from './utils/report-generator.js';
import { formatError } from './utils/error-handler.js';
import { logger } from './utils/logger.js';

/** Usage line shown alongside argument errors */
const USAGE = 'Usage: npm run dev -- <owner> <repo> <pr-number>';

/**
 * Print an error and exit with status 1
 */
function fail(message: string): never {
  console.error(`❌ ${message}`);
  process.exit(1);
}

/**
 * Main entry point for the Claude Multi-Agent Code Review System
 * Usage: npm run dev <owner> <repo> <pr-number>
 */
async function main() {
  const [owner, repo, prStr] = process.argv.slice(2);

  if (!owner || !repo || !prStr) {
    fail(`Missing arguments.\n${USAGE}\nExample: npm run dev -- facebook react 12345`);
  }

  const prNumber = Number(prStr);
  if (!Number.isInteger(prNumber) || prNumber <= 0) {
    fail(`Invalid PR number "${prStr}": must be a positive integer.\n${USAGE}`);
  }

  // Authentication: Anthropic API key, or AWS credentials for Bedrock
  const hasAnthropicKey = Boolean(process.env.ANTHROPIC_API_KEY);
  const hasAwsCredentials = Boolean(process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY);

  if (hasAnthropicKey) {
    console.log('🔐 Using Anthropic API authentication');
  } else if (hasAwsCredentials) {
    if (!process.env.AWS_REGION) {
      fail('AWS_REGION must be set when using AWS Bedrock authentication.');
    }
    // The Agent SDK routes requests through Bedrock when this flag is set
    process.env.CLAUDE_CODE_USE_BEDROCK ??= '1';
    console.log('🔐 Using AWS Bedrock authentication');
  } else {
    fail(`No authentication configured. Set ONE of the following:
   Option 1 (Anthropic API): ANTHROPIC_API_KEY=sk-ant-...
   Option 2 (AWS Bedrock):   AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY and AWS_REGION`);
  }

  const model = process.env.ANTHROPIC_MODEL;
  if (!model) {
    fail(`ANTHROPIC_MODEL is not set. Examples:
   Anthropic API: ANTHROPIC_MODEL=claude-sonnet-4-5-20250929
   AWS Bedrock:   ANTHROPIC_MODEL=us.anthropic.claude-sonnet-4-5-20250929-v1:0`);
  }

  const projectRoot = process.env.PROJECT_ROOT;
  if (!projectRoot || !path.isAbsolute(projectRoot)) {
    fail('PROJECT_ROOT must be set to the absolute path of project/starter (the directory containing .claude/skills/).');
  }
  if (!existsSync(path.join(projectRoot, '.claude', 'skills'))) {
    fail(`No .claude/skills/ directory found in PROJECT_ROOT (${projectRoot}). Skills will not load.`);
  }

  if (!process.env.GITHUB_TOKEN) {
    console.warn('⚠️  GITHUB_TOKEN not set: using unauthenticated GitHub access (60 requests/hour, public repos only).');
  }

  console.log(`🔍 Reviewing ${owner}/${repo}#${prNumber} with ${model}...`);

  try {
    const orchestrator = new CodeReviewOrchestrator({ model, projectRoot });
    const report = await orchestrator.reviewPullRequest(owner, repo, prNumber);

    const generator = new ReportGenerator();
    const reportsDir = path.join(projectRoot, 'reports');
    await mkdir(reportsDir, { recursive: true });

    const timestamp = report.metadata.analyzedAt.replace(/[:.]/g, '-');
    const baseName = `${owner}-${repo}-pr${prNumber}-${timestamp}`;
    const outputs = {
      md: generator.generateMarkdownReport(report),
      html: generator.generateHTMLReport(report),
      json: generator.generateJSONReport(report)
    };

    const written: string[] = [];
    for (const [ext, content] of Object.entries(outputs)) {
      const filePath = path.join(reportsDir, `${baseName}.${ext}`);
      await writeFile(filePath, content, 'utf-8');
      written.push(filePath);
    }

    const { summary } = report;
    console.log(`
✅ Review complete in ${(report.metadata.duration / 1000).toFixed(1)}s
   Overall score:             ${summary.overallScore}/100
   Files reviewed:            ${summary.totalFiles}
   Critical issues:           ${summary.criticalIssues}
   High-priority tests:       ${summary.highPriorityTests}
   Refactoring opportunities: ${summary.refactoringOpportunities}

📄 Reports:
${written.map(f => `   ${f}`).join('\n')}`);
  } catch (error) {
    logger.error('Review failed', { error: formatError(error) });
    console.error('❌ Error:', formatError(error));
    process.exitCode = 1;
  }
}

main();
