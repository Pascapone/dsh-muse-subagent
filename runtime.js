import { randomUUID } from 'node:crypto'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  settleRunResult,
  subprocessRunHandle,
} from '@deepseek-ai/dsh-subagent'

const PLUGIN = 'dsh-muse-subagent'
const STDERR_LIMIT = 8 * 1024
const MAX_JSONL_LINE_BYTES = 16 * 1024 * 1024
const MAX_OUTPUT_BYTES = 8 * 1024 * 1024

function asError(value) {
  return value instanceof Error ? value : new Error(String(value))
}

export function textTask(prompt) {
  if (!Array.isArray(prompt) || prompt.length === 0) {
    throw new Error(`${PLUGIN}: the one-shot task must contain only text blocks`)
  }
  const texts = []
  for (const block of prompt) {
    if (block?.type !== 'text' || typeof block.text !== 'string') {
      throw new Error(`${PLUGIN}: the one-shot task must contain only text blocks`)
    }
    texts.push(block.text)
  }
  if (texts.every(text => text.trim().length === 0)) {
    throw new Error(`${PLUGIN}: the one-shot task must not be empty`)
  }
  return texts.join('')
}

export function windowsPathToWslDetails(path, distribution) {
  const drive = /^([A-Za-z]):[\\/](.*)$/.exec(path)
  if (drive) {
    const rest = drive[2].replaceAll('\\', '/').replace(/^\/+/, '')
    return {
      path: `/mnt/${drive[1].toLowerCase()}/${rest}`,
      distribution,
    }
  }

  const unc = /^\\\\(?:wsl\$|wsl\.localhost)\\([^\\]+)\\?(.*)$/i.exec(path)
  if (unc) {
    if (distribution && unc[1].toLowerCase() !== distribution.toLowerCase()) {
      throw new Error(`${PLUGIN}: path belongs to WSL distribution ${unc[1]}, not ${distribution}`)
    }
    return {
      path: `/${unc[2].replaceAll('\\', '/').replace(/^\/+/, '')}`,
      distribution: distribution ?? unc[1],
    }
  }

  throw new Error(`${PLUGIN}: cannot map path to WSL: ${path}`)
}

export function windowsPathToWsl(path, distribution) {
  return windowsPathToWslDetails(path, distribution).path
}

export function createOutputState() {
  return {
    deltaChunks: [],
    deltaBytes: 0,
    terminal: undefined,
    terminalText: undefined,
  }
}

export function applyMuseJsonLine(line, state) {
  if (Buffer.byteLength(line, 'utf8') > MAX_JSONL_LINE_BYTES) {
    throw new Error(`${PLUGIN}: Muse JSONL record exceeded ${MAX_JSONL_LINE_BYTES} bytes`)
  }
  const trimmed = line.trim()
  if (trimmed.length === 0) return

  let record
  try {
    record = JSON.parse(trimmed)
  } catch (cause) {
    throw new Error(`${PLUGIN}: Muse emitted invalid JSONL on stdout`, { cause })
  }

  const payload = record?.payload
  if (!payload || typeof payload !== 'object') return

  if (payload.kind === 'run_output_delta' && typeof payload.text === 'string') {
    const bytes = Buffer.byteLength(payload.text, 'utf8')
    if (state.deltaBytes + bytes > MAX_OUTPUT_BYTES) {
      throw new Error(`${PLUGIN}: Muse answer exceeded ${MAX_OUTPUT_BYTES} bytes`)
    }
    state.deltaChunks.push(payload.text)
    state.deltaBytes += bytes
    return
  }

  if (payload.kind === 'run_terminal') {
    if (typeof payload.terminal !== 'string') {
      throw new Error(`${PLUGIN}: Muse terminal record has no terminal value`)
    }
    state.terminal = payload.terminal
    if (typeof payload.text === 'string') {
      if (Buffer.byteLength(payload.text, 'utf8') > MAX_OUTPUT_BYTES) {
        throw new Error(`${PLUGIN}: Muse final answer exceeded ${MAX_OUTPUT_BYTES} bytes`)
      }
      state.terminalText = payload.text
    }
  }
}

export async function consumeMuseJson(stream, state) {
  stream.setEncoding('utf8')
  let pending = ''
  for await (const chunk of stream) {
    pending += String(chunk)
    while (true) {
      const newline = pending.indexOf('\n')
      if (newline < 0) break
      const line = pending.slice(0, newline)
      pending = pending.slice(newline + 1)
      applyMuseJsonLine(line, state)
    }
    if (Buffer.byteLength(pending, 'utf8') > MAX_JSONL_LINE_BYTES) {
      throw new Error(`${PLUGIN}: Muse JSONL record exceeded ${MAX_JSONL_LINE_BYTES} bytes`)
    }
  }
  if (pending.trim().length > 0) applyMuseJsonLine(pending, state)
}

function outputText(state) {
  return state.terminalText ?? state.deltaChunks.join('')
}

function outputBlocks(state) {
  const text = outputText(state)
  return typeof text === 'string' && text.trim().length > 0
    ? [{ type: 'text', text }]
    : []
}

function outcomeFields(outcome) {
  const fields = []
  if (outcome?.exitCode !== null && outcome?.exitCode !== undefined) {
    fields.push(`exit code: ${outcome.exitCode}`)
  }
  if (outcome?.signal !== null && outcome?.signal !== undefined) {
    fields.push(`signal: ${outcome.signal}`)
  }
  return fields
}

function safeDiagnostic(category, outcome) {
  const fields = [
    'product: Muse Code',
    'stage: run',
    `category: ${category}`,
    ...outcomeFields(outcome),
  ]
  return `Product subagent failure (${fields.join('; ')})`
}

function appendTail(current, chunk) {
  const next = current + String(chunk)
  return next.length <= STDERR_LIMIT ? next : next.slice(next.length - STDERR_LIMIT)
}

export function museExecArguments(config, workspace, promptFile, mode) {
  const args = ['exec', '--json']
  if (config.noSessionLog) args.push('--no-session-log')
  if (mode === 'danger-full-access') args.push('--yolo')
  else if (mode === 'read-only') args.push('--permission-profile', ':read-only', '--disable-shell', '--disable-write')
  else if (mode === 'workspace-write') {
    if (config.approvalMode !== 'never') throw new Error(`${PLUGIN}: sandboxed runs require approvalMode never`)
    args.push('--approval-mode', 'never')
  } else throw new Error(`${PLUGIN}: unsupported file policy: ${mode}`)
  if (mode !== 'danger-full-access' && config.extraArgs.length > 0) {
    throw new Error(`${PLUGIN}: extraArgs cannot be used with a sandboxed Muse run`)
  }
  if (config.trustWorkspace && mode === 'workspace-write') args.push('--trust-workspace')
  if (config.provider) args.push('--provider', config.provider)
  if (config.model) args.push('--model', config.model)
  if (config.preset) args.push('--preset', config.preset)
  if (config.reasoningEffort) args.push('--reasoning-effort', config.reasoningEffort)
  args.push('--workspace', workspace)
  if (config.extraArgs.length > 0) args.push(...config.extraArgs)
  args.push('--prompt-file', promptFile)
  return args
}

function wslEnvironment(env) {
  const names = Object.keys(env)
  for (const name of names) {
    if (name === 'WSLENV' || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
      throw new Error(`${PLUGIN}: invalid WSL environment variable name: ${name}`)
    }
  }
  return names.length === 0
    ? {}
    : { ...env, WSLENV: names.join(':') }
}

async function resolveInvocation(ctx, config, cwd, promptFile, signal, mode) {
  const native = async () => {
    const executable = await ctx.subprocess.resolveExecutable(config.command, config.env, signal)
    return {
      argv: [executable, ...museExecArguments(config, cwd, promptFile, mode)],
      env: config.env,
    }
  }

  const wsl = async () => {
    const executable = await ctx.subprocess.resolveExecutable(config.wslExecutable, {}, signal)
    const workspace = windowsPathToWslDetails(cwd, config.wslDistribution)
    const effectiveDistribution = workspace.distribution ?? config.wslDistribution
    const wslPrompt = windowsPathToWsl(promptFile, effectiveDistribution)
    const prefix = [executable]
    if (effectiveDistribution) prefix.push('--distribution', effectiveDistribution)
    prefix.push('--cd', cwd, '--exec')
    prefix.push(config.wslCommand, ...museExecArguments(config, workspace.path, wslPrompt, mode))
    return { argv: prefix, env: wslEnvironment(config.env) }
  }

  if (config.runtime === 'native') return native()
  if (config.runtime === 'wsl') return wsl()

  try {
    return await native()
  } catch (nativeError) {
    if (signal.aborted || process.platform !== 'win32') throw nativeError
    return await wsl()
  }
}

async function removeTemp(path) {
  await rm(path, { force: true, recursive: true })
}

export async function startMuseRun(ctx, request, config, cwd, mode) {
  // Validate the policy before creating a prompt file or spawning a child.
  museExecArguments(config, cwd, 'prompt.txt', mode)
  const prompt = textTask(request.prompt)
  if (request.signal.aborted) {
    throw new Error(`${PLUGIN}: request was aborted before Muse startup`)
  }

  const tempDir = await mkdtemp(join(tmpdir(), 'dsh-muse-'))
  const promptFile = join(tempDir, 'prompt.txt')
  try {
    await writeFile(promptFile, prompt, { encoding: 'utf8', mode: 0o600 })
  } catch (error) {
    await removeTemp(tempDir).catch(() => {})
    throw error
  }

  let invocation
  try {
    invocation = await resolveInvocation(ctx, config, cwd, promptFile, request.signal, mode)
  } catch (error) {
    await removeTemp(tempDir).catch(() => {})
    throw new Error(`${PLUGIN}: could not resolve Muse executable`, { cause: error })
  }

  let child
  try {
    child = ctx.subprocess.spawn({
      argv: invocation.argv,
      cwd,
      stdio: { stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' },
      graceMs: config.disposeGraceMs,
      env: invocation.env,
    })
  } catch (error) {
    await removeTemp(tempDir).catch(() => {})
    throw new Error(`${PLUGIN}: Muse process could not be started`, { cause: error })
  }

  const state = createOutputState()
  let stderrTail = ''
  child.stderr?.setEncoding('utf8')
  child.stderr?.on('data', chunk => { stderrTail = appendTail(stderrTail, chunk) })
  child.stderr?.on('error', () => {})

  const stdoutTask = consumeMuseJson(child.stdout, state)
  const localAbort = new AbortController()
  const requestCancel = () => {
    if (localAbort.signal.aborted) return
    localAbort.abort(new Error(`${PLUGIN}: run cancelled locally`))
    child.terminate()
  }
  const onAbort = () => requestCancel()
  request.signal.addEventListener('abort', onAbort, { once: true })
  if (request.signal.aborted) requestCancel()

  let diagnostic
  const attempt = async () => {
    let outcome
    try {
      ;[outcome] = await Promise.all([child.done, stdoutTask])
    } catch (error) {
      diagnostic = safeDiagnostic('process', outcome)
      throw asError(error)
    }

    if (localAbort.signal.aborted) {
      throw new Error(`${PLUGIN}: Muse run was cancelled`)
    }

    if (state.terminal !== 'completed') {
      const category = state.terminal === undefined
        ? 'invalid-result'
        : /^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(state.terminal)
          ? `terminal-${state.terminal}`
          : 'terminal-unknown'
      diagnostic = safeDiagnostic(category, outcome)
      throw new Error(`${PLUGIN}: ${diagnostic}`)
    }

    const text = outputText(state)
    if (typeof text !== 'string' || text.trim().length === 0) {
      diagnostic = safeDiagnostic('invalid-result', outcome)
      throw new Error(`${PLUGIN}: Muse completed without a final answer`)
    }

    if (outcome.exitCode !== 0 || outcome.signal !== null) {
      diagnostic = safeDiagnostic('process', outcome)
      throw new Error(`${PLUGIN}: ${diagnostic}`)
    }

    return {
      output: [{ type: 'text', text }],
      stopReason: 'completed',
    }
  }

  const result = settleRunResult({
    attempt,
    collectOutput: () => outputBlocks(state),
    collectDiagnostic: () => diagnostic,
    cancelled: () => localAbort.signal.aborted,
    onError: (error, stopReason) => {
      const evidence = stderrTail.trim()
      ctx.logger.warn(
        `${PLUGIN} "${config.providerName}": child run failed (${stopReason}): ${error.message}`
          + (evidence.length > 0 ? `\nMuse stderr tail:\n${evidence}` : ''),
      )
    },
    signal: request.signal,
    onAbort,
  })

  const teardown = async () => {
    child.terminate()
    let teardownError
    try {
      await child.waitForExit()
      await child.done.catch(() => {})
    } catch (error) {
      teardownError = asError(error)
    }
    try {
      await removeTemp(tempDir)
    } catch (error) {
      teardownError = teardownError
        ? new AggregateError([teardownError, asError(error)], `${PLUGIN}: teardown failed`)
        : asError(error)
    }
    if (teardownError) throw teardownError
  }

  return subprocessRunHandle({
    id: randomUUID(),
    result,
    signal: request.signal,
    onAbort,
    requestCancel,
    teardown,
  })
}
