import type { SubagentResult } from '@deepseek-ai/dsh-subagent'
import type { ToolArgs } from '../types.js'
// Partial doubles retain exactly the fields exercised by the original tests.
export type SpawnSpec = { argv: string[]; cwd: string; env: Record<string, string>; stdio: { stdin: 'ignore'; stdout: 'pipe'; stderr: 'pipe' } }
export type TestTool = {
  description: string; parameters: { properties: { prompt: { description: string } } }
  execute(args: ToolArgs, exec: unknown): Promise<{ output: { type: 'text'; text: string }[] }>
}
export type TestRequest = { prompt: { type: string; text: string }[]; museOptions?: { sandboxed?: unknown; workspace?: unknown }; parent?: unknown; signal?: AbortSignal }
export type TestProvider = { start(request: TestRequest): Promise<{ result: Promise<SubagentResult>; dispose(): Promise<void> }> }
