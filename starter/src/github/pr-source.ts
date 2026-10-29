/**
 * Pull request data access
 * Defines the PullRequestSource interface and its GitHub MCP implementation
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { mcpServersConfig } from '../config/mcp.config.js';
import { ReviewError, ErrorCodes } from '../utils/error-handler.js';

/**
 * A file changed in a pull request (subset of GitHub's PR file payload)
 */
export interface PullRequestFile {
  filename: string;
  status: string;
  additions: number;
  deletions: number;
  patch?: string;
}

/**
 * Pull request metadata needed to fetch file contents at the PR head
 */
export interface PullRequestInfo {
  title: string;
  headSha: string;
  headOwner: string;
  headRepo: string;
}

/**
 * Source of pull request data
 * The orchestrator depends on this interface so tests can supply fakes
 */
export interface PullRequestSource {
  getPullRequest(owner: string, repo: string, prNumber: number): Promise<PullRequestInfo>;
  getPullRequestFiles(owner: string, repo: string, prNumber: number): Promise<PullRequestFile[]>;
  getFileContent(owner: string, repo: string, path: string, ref: string): Promise<string>;
  close(): Promise<void>;
}

/**
 * Fetches pull request data by calling the GitHub MCP server directly
 * Deterministic data fetching doesn't need an LLM, so this uses the MCP client
 */
export class GitHubMcpSource implements PullRequestSource {
  private client: Client | null = null;

  /**
   * Launch the GitHub MCP server on first use and reuse the connected client afterwards
   */
  private async connect(): Promise<Client> {
    if (this.client) return this.client;

    const { command, args, env } = mcpServersConfig.github;
    const transport = new StdioClientTransport({
      command,
      args,
      // The server needs PATH etc. to launch via npx
      env: { ...(process.env as Record<string, string>), ...env },
      stderr: 'pipe'
    });

    const client = new Client({ name: 'code-review-orchestrator', version: '1.0.0' });
    await client.connect(transport);
    this.client = client;
    return client;
  }

  /**
   * Call a GitHub MCP tool and parse its JSON text result
   * Tool errors are mapped to ReviewError codes (PR_NOT_FOUND, RATE_LIMITED, GITHUB_API_ERROR)
   */
  private async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    const client = await this.connect();
    const result = await client.callTool({ name, arguments: args });

    const content = result.content as Array<{ type: string; text?: string }> | undefined;
    const text = content?.find(c => c.type === 'text')?.text ?? '';

    if (result.isError) {
      const code = /not found/i.test(text) ? ErrorCodes.PR_NOT_FOUND
        : /rate limit/i.test(text) ? ErrorCodes.RATE_LIMITED
        : ErrorCodes.GITHUB_API_ERROR;
      throw new ReviewError(`GitHub MCP ${name} failed: ${text}`, code, args);
    }

    try {
      return JSON.parse(text);
    } catch {
      throw new ReviewError(`GitHub MCP ${name} returned non-JSON output`, ErrorCodes.GITHUB_API_ERROR, args);
    }
  }

  /**
   * Fetch the PR title and the repository/commit that hold its head
   */
  async getPullRequest(owner: string, repo: string, prNumber: number): Promise<PullRequestInfo> {
    const pr = await this.callTool('get_pull_request', { owner, repo, pull_number: prNumber }) as {
      title: string;
      head: { sha: string; repo: { name: string; owner: { login: string } } | null };
    };

    // Head repo is null when a fork was deleted; the base repo still serves the commit
    return {
      title: pr.title,
      headSha: pr.head.sha,
      headOwner: pr.head.repo?.owner.login ?? owner,
      headRepo: pr.head.repo?.name ?? repo
    };
  }

  /**
   * List the files changed in the PR, with diff stats and patches
   */
  async getPullRequestFiles(owner: string, repo: string, prNumber: number): Promise<PullRequestFile[]> {
    return await this.callTool('get_pull_request_files', { owner, repo, pull_number: prNumber }) as PullRequestFile[];
  }

  /**
   * Fetch a file's text at the given ref
   * Throws FILE_NOT_FOUND when the path has no content (e.g. a directory)
   */
  async getFileContent(owner: string, repo: string, path: string, ref: string): Promise<string> {
    const file = await this.callTool('get_file_contents', { owner, repo, path, branch: ref }) as {
      content?: string;
      encoding?: string;
    };

    if (typeof file.content !== 'string') {
      throw new ReviewError(`No content returned for ${path}`, ErrorCodes.FILE_NOT_FOUND, { path, ref });
    }
    // The MCP server decodes content itself but still reports GitHub's "base64" encoding,
    // so only decode when the payload actually is base64
    const isBase64 = file.encoding === 'base64' && /^[A-Za-z0-9+/=\r\n]+$/.test(file.content);
    return isBase64
      ? Buffer.from(file.content, 'base64').toString('utf-8')
      : file.content;
  }

  /**
   * Shut down the MCP server connection, if one was opened
   */
  async close(): Promise<void> {
    await this.client?.close();
    this.client = null;
  }
}
