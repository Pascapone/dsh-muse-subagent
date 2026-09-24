import z from '@deepseek-ai/schemastery'
import { settleRun } from '@deepseek-ai/dsh-subagent'

export const name = 'tool-subagent-muse'
export const inject = ['tools', 'subagents']

export const ORIGINAL_DESCRIPTION = 'Delegate a self-contained task to a subagent (a separate agent that works in its own context) to offload focused, independent work — research, a scoped implementation, an analysis — so it does not consume this conversation\'s context. The subagent returns its result, not its intermediate steps. Give it a complete, standalone prompt: it does not see this conversation. This call waits for the result by default. Set `run_in_background: true` to return a job id; collect with `job_output` and stop with `job_kill`.'
export const ORIGINAL_PROMPT_DESCRIPTION = 'The complete, self-contained task for the subagent. It does not share this conversation\'s context, so include everything it needs.'

const WINDOWS_WSL_NOTE = ' In this deployment, Muse Code runs only inside WSL and accesses the Windows workspace through /mnt/c/... paths; paths and installed runtimes therefore reflect its Linux environment.'
const WINDOWS_PROMPT_NOTE = ' Muse Code runs inside WSL and sees WSL/Linux paths for the Windows workspace.'

export function toolWording(platform = process.platform) {
  if (platform !== 'win32') {
    return {
      description: ORIGINAL_DESCRIPTION,
      promptDescription: ORIGINAL_PROMPT_DESCRIPTION,
    }
  }
  return {
    description: ORIGINAL_DESCRIPTION + WINDOWS_WSL_NOTE,
    promptDescription: ORIGINAL_PROMPT_DESCRIPTION + WINDOWS_PROMPT_NOTE,
  }
}

export const Config = z.object({
  provider: z.string().required().default('muse'),
  toolName: z.string().default('subagent_muse'),
  enableRunInBackground: z.boolean().default(true),
})

function textOutput(blocks) {
  return blocks
    .filter(block => block?.type === 'text' && typeof block.text === 'string')
    .map(block => block.text)
    .join('')
}

function failedResult(result) {
  if (result.stopReason === 'completed') return undefined
  const diagnostic = result.diagnostic ? `\nDiagnostic: ${result.diagnostic}` : ''
  const partial = textOutput(result.output)
  const partialText = partial ? `\nPartial output before the run ended:\n${partial}` : ''
  return `Muse subagent run ended abnormally (${String(result.stopReason)})${diagnostic}${partialText}`
}

async function settleForeground(run) {
  const [execution] = await Promise.allSettled([
    run.result.then(result => {
      const error = failedResult(result)
      if (error) throw new Error(error)
      return {
        kind: 'foreground',
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

async function settleBackgroundStart(start, signal) {
  try {
    return await settleRun(await start)
  } catch (error) {
    return signal.aborted && !(error instanceof AggregateError)
      ? { status: 'killed' }
      : { status: 'failed', detail: String(error) }
  }
}

export function apply(ctx, config) {
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
      render: (_args, value) => [{
        type: 'text',
        text: value.kind === 'background'
          ? `started background Muse subagent job ${value.jobId}`
          : textOutput(value.output),
      }],
    },
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      if (!args || typeof args !== 'object') throw new Error('Muse subagent arguments must be an object')
      if (typeof args.description !== 'string' || typeof args.prompt !== 'string') {
        throw new Error('Muse subagent requires string description and prompt arguments')
      }
      const parent = exec.agent
      if (!parent) throw new Error('Muse subagent tool requires a calling agent')
      if (!backgroundEnabled && args.run_in_background === true) {
        throw new Error('run_in_background is disabled for this Muse tool instance')
      }

      const request = {
        label: args.description,
        prompt: [{ type: 'text', text: args.prompt }],
        parent,
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
