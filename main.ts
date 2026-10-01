import type { MuseContext, MuseConfig, MuseRequest } from './types.js'
import { stat } from 'node:fs/promises'
import { isAbsolute } from 'node:path'
import z from '@deepseek-ai/schemastery'
import {
  NO_START_CAPABILITIES,
  assertPositiveFinite,
  resolveChildCwd,
} from '@deepseek-ai/dsh-subagent'
import { startMuseRun } from './runtime.js'
import { apply as applyMuseTool } from './tool-platform.js'

export const name = 'subagent-muse'
export const inject = ['subagents', 'subprocess', 'tools', 'sandboxPolicy']

const RUNTIMES = ['auto', 'native', 'wsl']
const APPROVAL_MODES = ['untrusted', 'on-request', 'never']
const REASONING_EFFORTS = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra']
const DEFAULT_DISPOSE_GRACE_MS = 3_000
const MAX_TIMER_DELAY_MS = 2_147_483_647

export const Config: z<Partial<MuseConfig>> = z.object({
  providerName: z.string().min(1).default('muse'),
  toolName: z.string().min(1).default('subagent_muse'),
  enableRunInBackground: z.boolean().default(true),
  runtime: z.union(RUNTIMES).default('auto'),
  command: z.string().min(1).default('muse'),
  wslExecutable: z.string().min(1).default('wsl.exe'),
  wslDistribution: z.string().min(1),
  wslCommand: z.string().min(1).default('muse'),
  provider: z.string().min(1),
  model: z.string().min(1),
  preset: z.string().min(1),
  reasoningEffort: z.union(REASONING_EFFORTS),
  approvalMode: z.union(APPROVAL_MODES).default('never'),
  trustWorkspace: z.boolean().default(true),
  noSessionLog: z.boolean().default(true),
  extraArgs: z.array(z.string()).default([]),
  env: z.dict(z.string()).default({}),
  disposeGraceMs: z.number().default(DEFAULT_DISPOSE_GRACE_MS),
})

class MuseProvider {
  declare name: string
  declare ctx: MuseContext
  declare config: MuseConfig
  capabilities = NO_START_CAPABILITIES
  inheritsParentContext = false

  constructor(providerName: string, ctx: MuseContext, config: MuseConfig) {
    this.name = providerName
    this.ctx = ctx
    this.config = config
  }

  async start(request: MuseRequest) {
    const policy = this.ctx.sandboxPolicy.resolve({ session: request.parent.session })
    const options = request.museOptions ?? {}
    if (options.sandboxed !== undefined && typeof options.sandboxed !== 'boolean') {
      throw new Error('dsh-muse-subagent: sandboxed must be a boolean')
    }
    if (options.workspace !== undefined && (typeof options.workspace !== 'string' || !isAbsolute(options.workspace))) {
      throw new Error('dsh-muse-subagent: workspace must be an absolute path')
    }
    if (policy.mode !== 'danger-full-access' && options.sandboxed === false) {
      throw new Error('dsh-muse-subagent: restricted agents cannot disable the Muse sandbox')
    }
    if (policy.mode !== 'danger-full-access' && options.workspace !== undefined) {
      throw new Error('dsh-muse-subagent: only full-access agents can select another workspace')
    }
    const cwd = options.workspace ?? resolveChildCwd(
      'dsh-muse-subagent', undefined, request.parent.session.header.cwd,
    )
    if (options.workspace !== undefined && !(await stat(cwd)).isDirectory()) {
      throw new Error('dsh-muse-subagent: workspace must be a directory')
    }
    const mode = options.sandboxed === true && policy.mode === 'danger-full-access'
      ? 'workspace-write' : policy.mode
    return await startMuseRun(this.ctx, request, this.config, cwd, mode)
  }
}

export function apply(ctx: MuseContext, config: Partial<MuseConfig>) {
  const resolved: MuseConfig = {
    providerName: config.providerName ?? 'muse',
    toolName: config.toolName ?? 'subagent_muse',
    enableRunInBackground: config.enableRunInBackground ?? true,
    runtime: config.runtime ?? 'auto',
    command: config.command ?? 'muse',
    wslExecutable: config.wslExecutable ?? 'wsl.exe',
    ...(config.wslDistribution === undefined ? {} : { wslDistribution: config.wslDistribution }),
    wslCommand: config.wslCommand ?? 'muse',
    ...(config.provider === undefined ? {} : { provider: config.provider }),
    ...(config.model === undefined ? {} : { model: config.model }),
    ...(config.preset === undefined ? {} : { preset: config.preset }),
    ...(config.reasoningEffort === undefined ? {} : { reasoningEffort: config.reasoningEffort }),
    approvalMode: config.approvalMode ?? 'never',
    trustWorkspace: config.trustWorkspace ?? true,
    noSessionLog: config.noSessionLog ?? true,
    extraArgs: config.extraArgs ?? [],
    env: config.env ?? {},
    disposeGraceMs: config.disposeGraceMs ?? DEFAULT_DISPOSE_GRACE_MS,
  }

  assertPositiveFinite('dsh-muse-subagent', 'disposeGraceMs', resolved.disposeGraceMs)
  if (resolved.disposeGraceMs > MAX_TIMER_DELAY_MS) {
    throw new Error(`dsh-muse-subagent: disposeGraceMs must be no greater than ${MAX_TIMER_DELAY_MS}`)
  }
  ctx.subagents.registerProvider(new MuseProvider(resolved.providerName, ctx, resolved))
  applyMuseTool(ctx, {
    provider: resolved.providerName,
    toolName: resolved.toolName,
    enableRunInBackground: resolved.enableRunInBackground,
  })
}
