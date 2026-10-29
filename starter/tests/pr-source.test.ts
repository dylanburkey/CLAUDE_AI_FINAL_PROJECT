/**
 * Tests for GitHubMcpSource content decoding
 */
import { describe, it, expect, vi } from 'vitest';
import { GitHubMcpSource } from '../src/github/pr-source.js';

/**
 * Stub the MCP client call so no server is launched
 */
function sourceReturning(payload: unknown) {
  const source = new GitHubMcpSource();
  vi.spyOn(source as unknown as { callTool: () => Promise<unknown> }, 'callTool').mockResolvedValue(payload);
  return source;
}

describe('GitHubMcpSource.getFileContent', () => {
  it('should return already-decoded content as-is', async () => {
    const code = "import x from 'y';\nconsole.log(x);\n";
    const source = sourceReturning({ encoding: 'base64', content: code });

    await expect(source.getFileContent('o', 'r', 'a.js', 'sha')).resolves.toBe(code);
  });

  it('should decode genuine base64 content', async () => {
    const code = 'const answer = 42;\n';
    const encoded = Buffer.from(code).toString('base64').replace(/(.{20})/g, '$1\n');
    const source = sourceReturning({ encoding: 'base64', content: encoded });

    await expect(source.getFileContent('o', 'r', 'a.js', 'sha')).resolves.toBe(code);
  });

  it('should throw when no content is returned (e.g. a directory)', async () => {
    const source = sourceReturning([{ name: 'a.js' }]);

    await expect(source.getFileContent('o', 'r', 'dir', 'sha')).rejects.toThrow(/No content/);
  });
});
