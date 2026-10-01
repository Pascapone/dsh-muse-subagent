import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { SubagentResult, SubagentRun } from '@deepseek-ai/dsh-subagent'
import type { JobOutcome } from '@deepseek-ai/dsh-jobs'
import type { MuseContext, ToolArgs, ToolConfig, ToolOutput } from './types.js'
import z from '@deepseek-ai/schemastery'
import { settleRun } from '@deepseek-ai/dsh-subagent'

export const name = 'tool-subagent-muse'
export const inject = ['tools', 'subagents']

export const ORIGINAL_DESCRIPTION = 'Delegate a self-contained task to a subagent (a separate agent that works in its own context) to offload focused, independent work — research, a scoped implementation, an analysis — so it does not consume this conversation\'s context. The subagent returns its result, not its intermediate steps. Give it a complete, standalone prompt: it does not see this conversation. This call waits for the result by default. Set `run_in_background: true` to return a job id; collect with `job_output` and stop with `job_kill`.'
export const ORIGINAL_PROMPT_DESCRIPTION = 'The complete, self-contained task for the subagent. It does not share this conversation\'s context, so include everything it needs.'

const WINDOWS_WSL_NOTE = ' In this deployment, Muse Code runs only inside WSL and accesses the Windows workspace through /mnt/c/... paths; paths and installed runtimes therefore reflect its Linux environment.'
const PERMISSION_NOTE = ' Muse inherits the calling Agent’s file-policy tier: restricted Agents stay sandboxed in their workspace; full-access Agents start unrestricted by default and may set sandboxed: true.'
const WINDOWS_PROMPT_NOTE = ' Muse Code runs inside WSL and sees WSL/Linux paths for the Windows workspace.'

export function toolWording(platform: string = process.platform) {
  if (platform !== 'win32') {
    return {
      description: ORIGINAL_DESCRIPTION + PERMISSION_NOTE,
      promptDescription: ORIGINAL_PROMPT_DESCRIPTION,
    }
  }
  return {
    description: ORIGINAL_DESCRIPTION + WINDOWS_WSL_NOTE + PERMISSION_NOTE,
    promptDescription: ORIGINAL_PROMPT_DESCRIPTION + WINDOWS_PROMPT_NOTE,
  }
}

export const Config = z.object({
  provider: z.string().required().default('muse'),
  toolName: z.string().default('subagent_muse'),
  enableRunInBackground: z.boolean().default(true),
})

function textOutput(blocks: readonly ContentBlock[]) {
  return blocks
    .filter((block): block is Extract<ContentBlock, { type: 'text' }> => block?.type === 'text' && typeof block.text === 'string')
    .map(block => block.text)
    .join('')
}

function failedResult(result: SubagentResult) {
  if (result.stopReason === 'completed') return undefined
  const diagnostic = result.diagnostic ? `\nDiagnostic: ${result.diagnostic}` : ''
  const partial = textOutput(result.output)
  const partialText = partial ? `\nPartial output before the run ended:\n${partial}` : ''
  return `Muse subagent run ended abnormally (${String(result.stopReason)})${diagnostic}${partialText}`
}

async function settleForeground(run: SubagentRun) {
  const [execution] = await Promise.allSettled([
    run.result.then(result => {
      const error = failedResult(result)
      if (error) throw new Error(error)
      return {
        kind: 'foreground' as const,
        runId: run.id,
        output: result.output,
      }
    }),
  ])
  const [disposal] = await Promise.allSettled([Promise.resolve().then(() => run.dispose())])
  if (execution.status === 'rejected') {
    if (disposal.status === 'rejected') {
      throw new AggregateError(
        [execution.reason, disposal.reason],
        `Muse subagent run failed: ${String(execution.reason)}; dispose failed: ${String(disposal.reason)}`,
      )
    }
    throw execution.reason
  }
  if (disposal.status === 'rejected') throw disposal.reason
  return execution.value
}

async function settleBackgroundStart(start: Promise<SubagentRun>, signal: AbortSignal): Promise<JobOutcome> {
  try {
    return await settleRun(await start)
  } catch (error) {
    return signal.aborted && !(error instanceof AggregateError)
      ? { status: 'killed' }
      : { status: 'failed', detail: String(error) }
  }
}

export function apply(ctx: Pick<MuseContext, 'tools' | 'subagents' | 'get'>, config: ToolConfig) {
  const provider = config.provider ?? 'muse'
  const toolName = config.toolName ?? 'subagent_muse'
  const backgroundEnabled = config.enableRunInBackground !== false
  const wording = toolWording()

  ctx.tools.register({
    name: toolName,
    description: wording.description,
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        description: {
          type: 'string',
          description: 'A short (3-5 word) description of the delegated task, for display.',
        },
        prompt: {
          type: 'string',
          description: wording.promptDescription,
        },
        sandboxed: {
          type: 'boolean',
          description: 'Constrain Muse to its workspace even when the calling Agent has full access. Restricted Agents are always sandboxed.',
        },
        workspace: {
          type: 'string',
          description: 'Optional absolute path to another workspace; requires the calling Agent to have danger-full-access. Defaults to the caller’s workspace.',
        },
        ...(backgroundEnabled ? {
          run_in_background: {
            type: 'boolean',
            description: 'Whether to run as a background job and return its id. Defaults to false; collect with job_output or stop with job_kill.',
          },
        } : {}),
      },
      required: ['description', 'prompt'],
    },
    output: {
      schema: { type: 'object' },
      render: (_args, raw) => {
        // Same-process canonical result is authored by this tool's execute, not external JSON.
        const value = raw as unknown as ToolOutput
        return [{
        type: 'text',
        text: value.kind === 'background'
          ? `started background Muse subagent job ${value.jobId}`
          : textOutput(value.output),
        }]
      },
    },
    isConcurrencySafe: () => true,
    async execute(input, exec): Promise<ToolOutput> {
      if (!input || typeof input !== 'object') throw new Error('Muse subagent arguments must be an object')
      const args = input as Record<string, unknown>
      if (typeof args.description !== 'string' || typeof args.prompt !== 'string') {
        throw new Error('Muse subagent requires string description and prompt arguments')
      }
      if (args.sandboxed !== undefined && typeof args.sandboxed !== 'boolean') {
        throw new Error('sandboxed must be a boolean')
      }
      if (args.workspace !== undefined && typeof args.workspace !== 'string') {
        throw new Error('workspace must be a string')
      }
      const parent = exec.agent
      if (!parent) throw new Error('Muse subagent tool requires a calling agent')
      if (!backgroundEnabled && args.run_in_background === true) {
        throw new Error('run_in_background is disabled for this Muse tool instance')
      }

      const request = {
        label: args.description,
        prompt: [{ type: 'text' as const, text: args.prompt }],
        parent,
        museOptions: { sandboxed: args.sandboxed, workspace: args.workspace },
      }

      if (args.run_in_background === true) {
        const jobs = ctx.get('jobs')
        if (!jobs) throw new Error('background jobs unavailable: load the jobs service and job tools')
        const id = jobs.start({
          kind: 'subagent',
          label: args.description,
          owner: parent.id,
          run: () => {
            const controller = new AbortController()
            const start = ctx.subagents.start(provider, { ...request, signal: controller.signal })
            return {
              cancel: reason => controller.abort(reason ?? 'background Muse subagent job killed'),
              done: settleBackgroundStart(start, controller.signal),
            }
          },
        })
        return { kind: 'background', jobId: id }
      }

      const run = await ctx.subagents.start(provider, { ...request, signal: exec.signal })
      return await settleForeground(run)
    },
  })
}
