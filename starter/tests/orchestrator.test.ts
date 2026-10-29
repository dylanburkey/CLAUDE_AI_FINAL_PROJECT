import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

// Silence console and file logging during tests
vi.mock('../src/utils/logger.js', () => {
  const noop = () => {};
  return {
    logger: { info: noop, warn: noop, error: noop, debug: noop },
    logReviewStart: noop,
    logReviewComplete: noop,
    logReviewError: noop,
    logAgentStart: noop,
    logAgentComplete: noop
  };
});

import { CodeReviewOrchestrator, buildReport } from '../src/orchestrator.js';
import type { QueryFn } from '../src/orchestrator.js';
import type { PullRequestSource, PullRequestFile } from '../src/github/pr-source.js';
import { ReviewReportSchema } from '../src/types/report-types.js';
import type { FileReview } from '../src/types/report-types.js';
import { DEFAULT_RATE_LIMITS } from '../src/utils/rate-limiter.js';

/**
 * Tests for CodeReviewOrchestrator
 * The GitHub MCP source and the Agent SDK query function are replaced with fakes
 */

/** Subagents the fake query reports launching via the Task tool */
const SUBAGENT_NAMES = ['code-quality-analyzer', 'test-coverage-analyzer', 'refactoring-suggester'];

/**
 * Fixture PR with two reviewable files, one non-source file, and one removed file
 */
const PR_FILES: PullRequestFile[] = [
  { filename: 'src/payment.ts', status: 'modified', additions: 40, deletions: 5, patch: '@@ -1 +1 @@\n+const x = 1;' },
  { filename: 'src/utils.js', status: 'added', additions: 10, deletions: 0, patch: '@@ +1 @@\n+var y = 2;' },
  { filename: 'README.md', status: 'modified', additions: 3, deletions: 1 },
  { filename: 'src/old.ts', status: 'removed', additions: 0, deletions: 30 }
];

/**
 * Build a valid FileReview with one critical issue, one high-priority test gap, and one refactoring
 */
function makeFileReview(file: string, overrides: Partial<{ score: number }> = {}): FileReview {
  return {
    file,
    codeQuality: {
      file,
      issues: [
        { line: 12, severity: 'critical', category: 'security', description: 'SQL injection', suggestion: 'Use parameters' },
        { line: 30, severity: 'low', category: 'style', description: 'Long line', suggestion: 'Wrap it' }
      ],
      overallScore: overrides.score ?? 80,
      summary: 'Mostly fine'
    },
    testCoverage: {
      file,
      hasTests: false,
      testFiles: [],
      untestedPaths: [
        { type: 'function', location: 'charge()', priority: 'high', reasoning: 'Handles money', suggestedTest: 'Charge declined card' }
      ],
      coverageEstimate: 10,
      summary: 'No tests'
    },
    refactorings: {
      file,
      suggestions: [
        { type: 'simplify', location: 'charge()', impact: 'high', description: 'Flatten nesting', before: 'if (a) { if (b) {} }', after: 'if (!a) return;', benefits: 'Readability' }
      ],
      summary: 'One refactoring'
    }
  };
}

/**
 * Fake PullRequestSource backed by PR_FILES, with every method a vi.fn spy
 */
function makeSource():PullRequestSource & { [K in keyof PullRequestSource]: ReturnType<typeof vi.fn> } {
  return {
    getPullRequest: vi.fn(async () => ({ title: 'Add payments', headSha: 'abc123', headOwner: 'acme', headRepo: 'shop' })),
    getPullRequestFiles: vi.fn(async () => PR_FILES),
    getFileContent: vi.fn(async (_o: string, _r: string, p: string) => `// contents of ${p}\n`),
    close: vi.fn(async () => {})
  };
}

/**
 * Fake SDK query: emits init, three parallel Task calls, their results, then structured output
 */
function makeQuery(output: (file: string) => unknown = file => makeFileReview(file)) {
  const prompts: string[] = [];
  const fn = vi.fn(({ prompt }: { prompt: AsyncIterable<{ message: { content: string } }> }) => (async function* () {
    let text = '';
    for await (const msg of prompt) text = msg.message.content;
    prompts.push(text);
    const file = /Repository path: (\S+)/.exec(text)![1]!;

    yield { type: 'system', subtype: 'init', mcp_servers: [{ name: 'github', status: 'connected' }] };
    yield {
      type: 'assistant',
      parent_tool_use_id: null,
      message: {
        content: SUBAGENT_NAMES.map((name, i) => ({
          type: 'tool_use', id: `t${i}`, name: 'Task', input: { subagent_type: name, prompt: '...' }
        }))
      }
    };
    yield {
      type: 'user',
      parent_tool_use_id: null,
      message: { content: SUBAGENT_NAMES.map((_, i) => ({ type: 'tool_result', tool_use_id: `t${i}`, content: '{}' })) }
    };
    yield {
      type: 'result',
      subtype: 'success',
      num_turns: 3,
      total_cost_usd: 0.01,
      modelUsage: { sonnet: { inputTokens: 1000, outputTokens: 500 } },
      structured_output: output(file)
    };
  })());
  return Object.assign(fn, { prompts }) as unknown as QueryFn & ReturnType<typeof vi.fn> & { prompts: string[] };
}

describe('CodeReviewOrchestrator', () => {
  let projectRoot: string;

  beforeEach(async () => {
    projectRoot = await mkdtemp(path.join(os.tmpdir(), 'review-test-'));
  });

  afterEach(async () => {
    await rm(projectRoot, { recursive: true, force: true });
  });

  function makeOrchestrator(queryFn = makeQuery(), source = makeSource()) {
    const orchestrator = new CodeReviewOrchestrator({
      projectRoot,
      model: 'test-model',
      source,
      queryFn,
      retryDelayMs: 1
    });
    return { orchestrator, queryFn, source };
  }

  describe('Configuration', () => {
    it('should initialize with default options', () => {
      const orchestrator = new CodeReviewOrchestrator({ source: makeSource() });

      expect(orchestrator.rateLimiter.getConfig()).toEqual(DEFAULT_RATE_LIMITS);
      expect(orchestrator.options.maxRetries).toBe(3);
      expect(orchestrator.options.retryDelayMs).toBe(1000);
      expect(orchestrator.options.maxFiles).toBe(10);
    });

    it('should accept custom rate limit configuration', () => {
      const orchestrator = new CodeReviewOrchestrator({
        source: makeSource(),
        rateLimits: { maxRequestsPerMinute: 10, maxConcurrent: 2 }
      });

      expect(orchestrator.rateLimiter.getConfig()).toEqual({
        maxRequestsPerMinute: 10,
        maxTokensPerMinute: DEFAULT_RATE_LIMITS.maxTokensPerMinute,
        maxConcurrent: 2
      });
    });
  });

  describe('reviewPullRequest', () => {
    it('should fetch PR files from GitHub MCP', async () => {
      const { orchestrator, source } = makeOrchestrator();

      await orchestrator.reviewPullRequest('acme', 'shop', 7);

      expect(source.getPullRequest).toHaveBeenCalledWith('acme', 'shop', 7);
      expect(source.getPullRequestFiles).toHaveBeenCalledWith('acme', 'shop', 7);
      // Only reviewable source files that still exist are fetched
      const fetched = source.getFileContent.mock.calls.map(c => c[2]);
      expect(fetched.sort()).toEqual(['src/payment.ts', 'src/utils.js']);
      expect(source.getFileContent).toHaveBeenCalledWith('acme', 'shop', 'src/payment.ts', 'abc123');
      expect(source.close).toHaveBeenCalled();
    });

    it('should spawn all 3 subagents in parallel', async () => {
      const { orchestrator, queryFn } = makeOrchestrator();

      await orchestrator.reviewPullRequest('acme', 'shop', 7);

      expect(queryFn).toHaveBeenCalledTimes(2);
      const { options } = queryFn.mock.calls[0]![0];
      expect(Object.keys(options.agents).sort()).toEqual([...SUBAGENT_NAMES].sort());
      expect(options.allowedTools).toContain('Task');
      expect(options.allowedTools).toContain('Skill');
      expect(options.settingSources).toEqual(['project']);
      expect(options.cwd).toBe(projectRoot);
      expect(Object.keys(options.mcpServers).sort()).toEqual(['eslint', 'github']);
      expect(options.outputFormat.type).toBe('json_schema');

      // The orchestrator prompt asks for all three Task calls in one message
      const prompt = queryFn.prompts[0]!;
      expect(prompt).toMatch(/SINGLE message/);
      for (const name of SUBAGENT_NAMES) expect(prompt).toContain(name);
    });

    it('should aggregate results into ReviewReport', async () => {
      const { orchestrator } = makeOrchestrator(makeQuery(file =>
        makeFileReview(file, { score: file.endsWith('.ts') ? 90 : 70 })
      ));

      const report = await orchestrator.reviewPullRequest('acme', 'shop', 7);

      expect(report.pullRequest).toEqual({ owner: 'acme', repo: 'shop', number: 7 });
      expect(report.fileReviews.map(r => r.file).sort()).toEqual(['src/payment.ts', 'src/utils.js']);
      expect(report.summary).toEqual({
        totalFiles: 2,
        overallScore: 80,
        criticalIssues: 2,
        highPriorityTests: 2,
        refactoringOpportunities: 2
      });
      expect(report.recommendations[0]).toMatchObject({ priority: 'critical', category: 'security' });
      expect(report.recommendations[0]!.files.sort()).toEqual(['src/payment.ts', 'src/utils.js']);
      expect(report.metadata.agentVersions).toMatchObject({
        orchestrator: '1.0.0',
        'code-quality-analyzer': '1.0.0',
        model: 'test-model'
      });
      expect(ReviewReportSchema.safeParse(report).success).toBe(true);
    });

    it('should validate output with Zod schema', async () => {
      const queryFn = makeQuery(file => ({ file, codeQuality: { overallScore: 'great' } }));
      const { orchestrator } = makeOrchestrator(queryFn);

      await expect(orchestrator.reviewPullRequest('acme', 'shop', 7)).rejects.toThrow(/All file reviews failed/);
      // Each file is retried before giving up
      expect(queryFn).toHaveBeenCalledTimes(2 * 3);
    });

    it('should degrade gracefully when one file fails', async () => {
      const queryFn = makeQuery(file => file === 'src/utils.js' ? { invalid: true } : makeFileReview(file));
      const { orchestrator } = makeOrchestrator(queryFn);

      const report = await orchestrator.reviewPullRequest('acme', 'shop', 7);

      expect(report.fileReviews.map(r => r.file)).toEqual(['src/payment.ts']);
      expect(report.recommendations).toContainEqual(expect.objectContaining({
        category: 'review-incomplete',
        files: ['src/utils.js']
      }));
    });

    it('should pin file names to the repository path', async () => {
      const { orchestrator } = makeOrchestrator(makeQuery(file => makeFileReview(`/tmp/x/${file}`)));

      const report = await orchestrator.reviewPullRequest('acme', 'shop', 7);

      for (const review of report.fileReviews) {
        expect(review.codeQuality.file).toBe(review.file);
        expect(review.testCoverage.file).toBe(review.file);
        expect(review.refactorings.file).toBe(review.file);
      }
    });

    it('should clean up local file copies', async () => {
      const { orchestrator } = makeOrchestrator();

      await orchestrator.reviewPullRequest('acme', 'shop', 7);

      expect(await readdir(path.join(projectRoot, '.temp'))).toEqual([]);
    });

    it('should reject file paths that escape the work directory', async () => {
      const source = makeSource();
      source.getPullRequestFiles.mockResolvedValue([
        { filename: '../../escape.js', status: 'added', additions: 1, deletions: 0 }
      ]);
      const { orchestrator, queryFn } = makeOrchestrator(makeQuery(), source);

      await expect(orchestrator.reviewPullRequest('acme', 'shop', 7)).rejects.toThrow(/All file reviews failed/);
      expect(queryFn).not.toHaveBeenCalled();
    });

    it('should fail when the agent session errors', async () => {
      const queryFn = vi.fn(() => (async function* () {
        yield { type: 'result', subtype: 'error_max_turns', errors: [] };
      })()) as unknown as QueryFn & ReturnType<typeof vi.fn>;
      const { orchestrator } = makeOrchestrator(queryFn);

      await expect(orchestrator.reviewPullRequest('acme', 'shop', 7)).rejects.toThrow(/All file reviews failed/);
    });
  });

  describe('buildReport', () => {
    it('should produce an empty but valid report when no files are reviewable', () => {
      const report = buildReport({ owner: 'a', repo: 'b', prNumber: 1, fileReviews: [], duration: 5, model: 'm' });

      expect(report.summary.totalFiles).toBe(0);
      expect(report.recommendations).toEqual([]);
      expect(ReviewReportSchema.safeParse(report).success).toBe(true);
    });
  });

  describe('Integration', () => {
    // These tests require actual API keys and should be skipped in CI
    it.skip('should review a real small PR', async () => {
      const orchestrator = new CodeReviewOrchestrator();
      const report = await orchestrator.reviewPullRequest('octocat', 'Hello-World', 1);
      expect(ReviewReportSchema.safeParse(report).success).toBe(true);
    });
  });
});
