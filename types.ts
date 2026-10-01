import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-subprocess'
import type {} from '@deepseek-ai/dsh-subagent'
import type {} from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-jobs'
import type {} from '@deepseek-ai/dsh-sandbox-policy'
import type { SubagentStartRequest } from '@deepseek-ai/dsh-subagent'
export type MuseContext = Pick<Context, 'subagents' | 'subprocess' | 'tools' | 'sandboxPolicy' | 'get' | 'logger'>
export type RunContext = { subprocess: Pick<Context['subprocess'], 'resolveExecutable' | 'spawn'>; logger: Pick<Context['logger'], 'warn'> }
export type ResolveContext = { subprocess: Pick<Context['subprocess'], 'resolveExecutable'> }
export type MuseOptions = { sandboxed?: unknown; workspace?: unknown }
export type MuseRequest = SubagentStartRequest & { museOptions?: MuseOptions }
export type Attribution = { parent?: { session?: { header?: { id?: string; cwd?: string } } } }
export type MuseConfig = {
  providerName: string; toolName: string; enableRunInBackground: boolean
  runtime: string; command: string; wslExecutable: string; wslDistribution?: string; wslCommand: string
  provider?: string; model?: string; preset?: string; reasoningEffort?: string
  approvalMode: string; trustWorkspace: boolean; noSessionLog: boolean; extraArgs: string[]
  env: Record<string, string>; disposeGraceMs: number
}
export type ExecConfig = Pick<MuseConfig, 'extraArgs'> & Partial<Pick<MuseConfig, 'noSessionLog' | 'approvalMode' | 'trustWorkspace' | 'provider' | 'model' | 'preset' | 'reasoningEffort' | 'env'>>
export type InvocationConfig = ExecConfig & Pick<MuseConfig, 'runtime' | 'command' | 'wslExecutable' | 'wslCommand' | 'wslDistribution'>
export type RunConfig = InvocationConfig & Pick<MuseConfig, 'providerName' | 'disposeGraceMs'>
export type OutputState = { deltaChunks: string[]; deltaBytes: number; terminal?: string; terminalText?: string }
export type ToolConfig = { provider?: string; toolName?: string; enableRunInBackground?: boolean }
export type ToolArgs = { description: string; prompt: string; sandboxed?: boolean; workspace?: string; run_in_background?: boolean }
export type ToolOutput = { kind: 'background'; jobId: string } | { kind: 'foreground'; runId: string; output: import('@deepseek-ai/dsh-subagent').SubagentResult['output'] }
