/**
 * Code review orchestrator
 * Fetches PR files, runs one agent session per file that fans out to the three subagents,
 * validates their structured output, and aggregates everything into a ReviewReport
 */
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { query } from '@anthropic-ai/claude-agent-sdk';
import type { SDKMessage, SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
import { ReviewReportSchema, FileReviewSchema, FileReviewJSONSchema } from './types/report-types.js';
import type { ReviewReport, FileReview } from './types/report-types.js';
import { subagents, subagentTools, agentVersions } from './agents/index.js';
import { buildOrchestratorPrompt } from './prompts/index.js';
import type { FileReviewContext } from './prompts/index.js';
import { mcpServersConfig } from './config/mcp.config.js';
import { GitHubMcpSource } from './github/pr-source.js';
import type { PullRequestSource, PullRequestFile } from './github/pr-source.js';
import { RateLimiter } from './utils/rate-limiter.js';
import type { RateLimiterConfig } from './utils/rate-limiter.js';
import { ReviewError, ErrorCodes, withRetry, withTimeout, formatError } from './utils/error-handler.js';
import {
  logger,
  logReviewStart,
  logReviewComplete,
  logReviewError,
  logAgentStart,
  logAgentComplete
} from './utils/logger.js';

/** Orchestrator version recorded in report metadata */
export const ORCHESTRATOR_VERSION = '1.0.0';

/**
 * Signature of the SDK's query function, injectable for testing
 */
export type QueryFn = typeof query;

/**
 * Orchestrator configuration options
 */
export interface OrchestratorOptions {
  /** Overrides for the API rate limiter */
  rateLimits?: Partial<RateLimiterConfig>;
  /** Model for the orchestrator; subagents inherit it (default: ANTHROPIC_MODEL) */
  model?: string;
  /** Directory containing .claude/skills/ (default: PROJECT_ROOT or cwd) */
  projectRoot?: string;
  /** Maximum files reviewed per PR, largest changes first (default: 10) */
  maxFiles?: number;
  /** Files larger than this are skipped (default: 100 KB) */
  maxFileBytes?: number;
  /** Timeout for one file's review (default: 10 minutes) */
  agentTimeoutMs?: number;
  /** Attempts per file before giving up (default: 3) */
  maxRetries?: number;
  /** Base delay for exponential backoff (default: 1000 ms) */
  retryDelayMs?: number;
  /** Extended thinking budget for the analysis agents (default: 8000) */
  maxThinkingTokens?: number;
  /** Turn limit for each file's agent session (default: 40) */
  maxTurns?: number;
  /** Pull request data source (default: GitHub MCP server) */
  source?: PullRequestSource;
  /** SDK query function (default: the real SDK) */
  queryFn?: QueryFn;
}

/** Options after defaults are applied; injectables are stored separately */
type ResolvedOptions = Required<Omit<OrchestratorOptions, 'rateLimits' | 'source' | 'queryFn'>>;

/**
 * Source file extensions worth sending to the analysis agents
 */
const REVIEWABLE_EXTENSIONS = new Set([
  '.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx', '.mts', '.cts',
  '.py', '.java', '.kt', '.go', '.rs', '.rb', '.php', '.cs',
  '.swift', '.c', '.h', '.cpp', '.hpp', '.scala', '.vue', '.svelte'
]);

/** Tools the orchestrator agent never needs; it reviews, it doesn't modify */
const DISALLOWED_TOOLS = ['Bash', 'Write', 'Edit', 'NotebookEdit', 'WebFetch', 'WebSearch'];

/** Rough upper bound for one file: orchestrator plus three subagents, each reading the file */
const BASE_TOKENS_PER_AGENT = 3000;
/** Agent sessions per reviewed file: the orchestrator plus three subagents */
const AGENTS_PER_FILE = 4;

/** Sort rank for recommendation priorities, most urgent first */
const PRIORITY_ORDER = { critical: 0, high: 1, medium: 2, low: 3 } as const;
/** Recommendation priority level */
type Priority = keyof typeof PRIORITY_ORDER;
/** A single entry in the report's recommendations list */
type Recommendation = ReviewReport['recommendations'][number];

/**
 * Main Code Review Orchestrator
 * Coordinates subagents to analyze pull requests and generate comprehensive reports
 */
export class CodeReviewOrchestrator {
  readonly options: ResolvedOptions;
  readonly rateLimiter: RateLimiter;
  private readonly source: PullRequestSource;
  private readonly queryFn: QueryFn;

  /**
   * Apply option defaults from arguments, then environment variables, then built-in values
   */
  constructor(options: OrchestratorOptions = {}) {
    this.options = {
      model: options.model ?? process.env.ANTHROPIC_MODEL ?? 'sonnet',
      projectRoot: options.projectRoot ?? process.env.PROJECT_ROOT ?? process.cwd(),
      maxFiles: options.maxFiles ?? 10,
      maxFileBytes: options.maxFileBytes ?? 100_000,
      agentTimeoutMs: options.agentTimeoutMs ?? 10 * 60 * 1000,
      maxRetries: options.maxRetries ?? 3,
      retryDelayMs: options.retryDelayMs ?? 1000,
      maxThinkingTokens: options.maxThinkingTokens ?? 8000,
      maxTurns: options.maxTurns ?? 40
    };
    this.rateLimiter = new RateLimiter(options.rateLimits);
    this.source = options.source ?? new GitHubMcpSource();
    this.queryFn = options.queryFn ?? query;
  }

  /**
   * Review a pull request using parallel subagent analysis
   * @param owner - Repository owner
   * @param repo - Repository name
   * @param prNumber - Pull request number
   * @returns Complete review report
   */
  async reviewPullRequest(
    owner: string,
    repo: string,
    prNumber: number
  ): Promise<ReviewReport> {
    const startTime = Date.now();
    const workDir = path.join(this.options.projectRoot, '.temp', `${owner}-${repo}-pr${prNumber}-${startTime}`);
    logReviewStart(owner, repo, prNumber);

    try {
      const { retry } = this;
      const pr = await retry(() => this.source.getPullRequest(owner, repo, prNumber));
      const allFiles = await retry(() => this.source.getPullRequestFiles(owner, repo, prNumber));
      const files = this.selectFiles(allFiles);
      const changedFiles = allFiles.map(f => f.filename);

      logger.info('Fetched pull request files', {
        title: pr.title,
        changed: allFiles.length,
        reviewing: files.map(f => f.filename)
      });

      // Every file is reviewed concurrently; the rate limiter caps actual parallelism
      const results = await Promise.allSettled(files.map(async file => {
        const content = await retry(() =>
          this.source.getFileContent(pr.headOwner, pr.headRepo, file.filename, pr.headSha)
        );
        if (Buffer.byteLength(content) > this.options.maxFileBytes) {
          throw new ReviewError(`File exceeds ${this.options.maxFileBytes} bytes`, ErrorCodes.VALIDATION_FAILED);
        }
        const localPath = await writeLocalCopy(workDir, file.filename, content);

        return this.reviewFile({
          owner,
          repo,
          prNumber,
          prTitle: pr.title,
          headOwner: pr.headOwner,
          headRepo: pr.headRepo,
          headSha: pr.headSha,
          filename: file.filename,
          localPath,
          status: file.status,
          patch: file.patch,
          changedFiles
        }, content.length);
      }));

      const fileReviews: FileReview[] = [];
      const failedFiles: string[] = [];
      results.forEach((result, i) => {
        const filename = files[i]!.filename;
        if (result.status === 'fulfilled') {
          fileReviews.push(result.value);
        } else {
          // Graceful degradation: one failed file shouldn't sink the whole review
          failedFiles.push(filename);
          logger.error('File review failed', { file: filename, error: formatError(result.reason) });
        }
      });

      if (files.length > 0 && fileReviews.length === 0) {
        throw new ReviewError('All file reviews failed', ErrorCodes.AGENT_FAILED, { failedFiles });
      }

      const report = buildReport({
        owner,
        repo,
        prNumber,
        fileReviews,
        failedFiles,
        duration: Date.now() - startTime,
        model: this.options.model
      });

      logReviewComplete(owner, repo, prNumber, report.summary.overallScore, report.metadata.duration);
      return report;
    } catch (error) {
      logReviewError(owner, repo, prNumber, error instanceof Error ? error : new Error(String(error)));
      throw error;
    } finally {
      await rm(workDir, { recursive: true, force: true });
      await this.source.close();
    }
  }

  /**
   * Run the orchestrator agent for one file; it spawns the three subagents
   * Retried with backoff, rate limited, and bounded by a timeout
   */
  async reviewFile(ctx: FileReviewContext, contentChars: number): Promise<FileReview> {
    const { maxTokensPerMinute } = this.rateLimiter.getConfig();
    const estimatedTokens = Math.min(
      maxTokensPerMinute,
      AGENTS_PER_FILE * (BASE_TOKENS_PER_AGENT + Math.ceil(contentChars / 4))
    );

    return this.retry(async () => {
      await this.rateLimiter.acquire(estimatedTokens);
      const abortController = new AbortController();
      let tokensUsed: number | undefined;

      try {
        const { review, tokens } = await withTimeout(
          () => this.runFileQuery(ctx, abortController),
          this.options.agentTimeoutMs,
          `Review of ${ctx.filename} timed out`
        );
        tokensUsed = tokens;
        return review;
      } finally {
        abortController.abort();
        this.rateLimiter.release(tokensUsed);
      }
    });
  }

  private async runFileQuery(
    ctx: FileReviewContext,
    abortController: AbortController
  ): Promise<{ review: FileReview; tokens: number }> {
    const startTimes = new Map<string, { agent: string; start: number }>();

    const messages = this.queryFn({
      prompt: singleMessage(buildOrchestratorPrompt(ctx)),
      options: {
        model: this.options.model,
        cwd: this.options.projectRoot,
        // Loads Claude Skills from <projectRoot>/.claude/skills/
        settingSources: ['project'],
        agents: subagents,
        mcpServers: mcpServersConfig,
        allowedTools: ['Task', ...subagentTools],
        disallowedTools: DISALLOWED_TOOLS,
        maxThinkingTokens: this.options.maxThinkingTokens,
        maxTurns: this.options.maxTurns,
        outputFormat: { type: 'json_schema', schema: FileReviewJSONSchema },
        abortController
      }
    });

    for await (const message of messages) {
      this.trackAgents(message, ctx.filename, startTimes);

      if (message.type !== 'result') continue;

      if (message.subtype !== 'success') {
        throw new ReviewError(
          `Agent session for ${ctx.filename} ended with ${message.subtype}`,
          message.subtype === 'error_max_structured_output_retries'
            ? ErrorCodes.STRUCTURED_OUTPUT_FAILED
            : ErrorCodes.AGENT_FAILED,
          { file: ctx.filename, errors: message.errors }
        );
      }
      if (message.structured_output === undefined) {
        throw new ReviewError(`No structured output for ${ctx.filename}`, ErrorCodes.STRUCTURED_OUTPUT_FAILED);
      }

      const parsed = FileReviewSchema.safeParse(message.structured_output);
      if (!parsed.success) {
        throw new ReviewError(
          `Structured output validation failed for ${ctx.filename}`,
          ErrorCodes.VALIDATION_FAILED,
          { issues: parsed.error.issues }
        );
      }

      const tokens = Object.values(message.modelUsage ?? {})
        .reduce((sum, u) => sum + u.inputTokens + u.outputTokens, 0);
      logger.info('File reviewed', {
        file: ctx.filename,
        turns: message.num_turns,
        costUsd: message.total_cost_usd,
        tokens
      });

      // Pin file names to the repository path regardless of what the agents echoed back
      const review = parsed.data;
      return {
        review: {
          file: ctx.filename,
          codeQuality: { ...review.codeQuality, file: ctx.filename },
          testCoverage: { ...review.testCoverage, file: ctx.filename },
          refactorings: { ...review.refactorings, file: ctx.filename }
        },
        tokens
      };
    }

    throw new ReviewError(`Agent session for ${ctx.filename} ended without a result`, ErrorCodes.AGENT_FAILED);
  }

  /**
   * Log MCP server health and subagent start/finish from the message stream
   */
  private trackAgents(
    message: SDKMessage,
    file: string,
    startTimes: Map<string, { agent: string; start: number }>
  ): void {
    if (message.type === 'system' && message.subtype === 'init') {
      for (const server of message.mcp_servers) {
        if (server.status !== 'connected') {
          // Agents fall back to manual analysis, so this degrades rather than fails
          logger.warn('MCP server not connected', { server: server.name, status: server.status, file });
        }
      }
      return;
    }

    // Only the orchestrator's own turns spawn and receive subagents
    if (message.type !== 'assistant' && message.type !== 'user') return;
    const content = message.message.content;
    if (!Array.isArray(content)) return;

    if (message.parent_tool_use_id !== null) {
      const agent = startTimes.get(message.parent_tool_use_id)?.agent ?? 'unknown';
      for (const block of content) {
        if (block.type === 'tool_use') {
          const input = block.input as { skill?: string; command?: string };
          logger.debug('Subagent tool call', { agent, tool: block.name, skill: input.skill ?? input.command, file });
        }
      }
      return;
    }

    for (const block of content) {
      if (block.type === 'tool_use' && block.name === 'Task') {
        const agent = (block.input as { subagent_type?: string }).subagent_type ?? 'unknown';
        startTimes.set(block.id, { agent, start: Date.now() });
        logAgentStart(agent, file);
      } else if (block.type === 'tool_result') {
        const started = startTimes.get(block.tool_use_id);
        if (started) logAgentComplete(started.agent, file, Date.now() - started.start);
      }
    }
  }

  /**
   * Pick reviewable source files, largest changes first, capped at maxFiles
   * Removed files and non-source extensions are skipped
   */
  private selectFiles(files: PullRequestFile[]): PullRequestFile[] {
    const reviewable = files.filter(f =>
      f.status !== 'removed' && REVIEWABLE_EXTENSIONS.has(path.extname(f.filename).toLowerCase())
    );
    const selected = [...reviewable]
      .sort((a, b) => (b.additions + b.deletions) - (a.additions + a.deletions))
      .slice(0, this.options.maxFiles);

    const skipped = files.filter(f => !selected.includes(f)).map(f => f.filename);
    if (skipped.length > 0) {
      logger.info('Skipping files', { count: skipped.length, files: skipped });
    }
    return selected;
  }

  private retry = <T>(fn: () => Promise<T>): Promise<T> =>
    withRetry(fn, this.options.maxRetries, this.options.retryDelayMs);
}

/**
 * Async generator input mode (streaming pattern), recommended for MCP compatibility
 */
async function* singleMessage(content: string): AsyncGenerator<SDKUserMessage> {
  yield {
    type: 'user',
    message: { role: 'user', content },
    parent_tool_use_id: null,
    session_id: 'code-review-session'
  };
}

/**
 * Write a PR file under workDir, refusing paths that escape it
 */
async function writeLocalCopy(workDir: string, filename: string, content: string): Promise<string> {
  const localPath = path.resolve(workDir, filename);
  if (!localPath.startsWith(path.resolve(workDir) + path.sep)) {
    throw new ReviewError(`Unsafe file path: ${filename}`, ErrorCodes.VALIDATION_FAILED);
  }
  await mkdir(path.dirname(localPath), { recursive: true });
  await writeFile(localPath, content, 'utf-8');
  return localPath;
}

/**
 * Aggregate per-file reviews into the final validated report
 */
export function buildReport(input: {
  owner: string;
  repo: string;
  prNumber: number;
  fileReviews: FileReview[];
  failedFiles?: string[];
  duration: number;
  model: string;
}): ReviewReport {
  const { fileReviews, failedFiles = [] } = input;

  const issues = fileReviews.flatMap(r => r.codeQuality.issues.map(issue => ({ ...issue, file: r.file })));
  const untested = fileReviews.flatMap(r => r.testCoverage.untestedPaths.map(p => ({ ...p, file: r.file })));
  const refactorings = fileReviews.flatMap(r => r.refactorings.suggestions.map(s => ({ ...s, file: r.file })));

  const overallScore = fileReviews.length > 0
    ? Math.round(fileReviews.reduce((sum, r) => sum + r.codeQuality.overallScore, 0) / fileReviews.length)
    : 100;

  const recommendations: Recommendation[] = [];

  // Code quality: one recommendation per severity + category
  for (const severity of ['critical', 'high', 'medium'] as const) {
    const bySeverity = issues.filter(i => i.severity === severity);
    for (const [category, group] of groupBy(bySeverity, i => i.category)) {
      const first = group[0]!;
      recommendations.push({
        priority: severity,
        category,
        description: group.length === 1
          ? `${first.description} Fix: ${first.suggestion}`
          : `${group.length} ${severity}-severity ${category} issues, e.g. ${first.description}`,
        files: unique(group.map(i => i.file))
      });
    }
  }

  // Test coverage: important untested paths
  for (const priority of ['critical', 'high'] as const) {
    const group = untested.filter(p => p.priority === priority);
    if (group.length === 0) continue;
    recommendations.push({
      priority,
      category: 'testing',
      description: `Add tests for ${group.length} ${priority}-priority untested path(s): ${group.slice(0, 3).map(p => p.location).join(', ')}`,
      files: unique(group.map(p => p.file))
    });
  }

  // Refactoring: high-impact suggestions are worth scheduling, medium ones are optional
  for (const [impact, priority] of [['high', 'medium'], ['medium', 'low']] as const) {
    const group = refactorings.filter(s => s.impact === impact);
    if (group.length === 0) continue;
    recommendations.push({
      priority,
      category: 'refactoring',
      description: `${group.length} ${impact}-impact refactoring(s): ${group.slice(0, 3).map(s => s.description).join('; ')}`,
      files: unique(group.map(s => s.file))
    });
  }

  if (failedFiles.length > 0) {
    recommendations.push({
      priority: 'high',
      category: 'review-incomplete',
      description: `${failedFiles.length} file(s) could not be analyzed automatically and need manual review.`,
      files: failedFiles
    });
  }

  recommendations.sort((a, b) =>
    PRIORITY_ORDER[a.priority as Priority] - PRIORITY_ORDER[b.priority as Priority] ||
    b.files.length - a.files.length
  );

  return ReviewReportSchema.parse({
    pullRequest: { owner: input.owner, repo: input.repo, number: input.prNumber },
    fileReviews,
    summary: {
      totalFiles: fileReviews.length,
      overallScore,
      criticalIssues: issues.filter(i => i.severity === 'critical').length,
      highPriorityTests: untested.filter(p => p.priority === 'critical' || p.priority === 'high').length,
      refactoringOpportunities: refactorings.length
    },
    recommendations,
    metadata: {
      analyzedAt: new Date().toISOString(),
      duration: input.duration,
      agentVersions: {
        orchestrator: ORCHESTRATOR_VERSION,
        ...agentVersions,
        model: input.model
      }
    }
  });
}

/**
 * Group items into a map keyed by the result of `key`, preserving input order
 */
function groupBy<T>(items: T[], key: (item: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const k = key(item);
    groups.set(k, [...(groups.get(k) ?? []), item]);
  }
  return groups;
}

/**
 * Remove duplicate strings, keeping first occurrences in order
 */
function unique(values: string[]): string[] {
  return [...new Set(values)];
}
