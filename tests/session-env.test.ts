import type { InvocationConfig, RunConfig, RunContext, MuseRequest } from '../types.js'
import type { SpawnSpec } from './fixture-types.js'
import assert from 'node:assert/strict'
import test from 'node:test'
import { PassThrough } from 'node:stream'
import { resolveInvocation, startMuseRun } from '../runtime.js'

test('DSH_SESSION_ID per-run attribution for native and WSL overrides spoof', async () => {
  const sessionId = 'parent-session-123'
  const withSession = (header: { id?: string; cwd?: string }) => ({ parent: { session: { header } } })
  const baseExec = {
    approvalMode: 'never',
    extraArgs: [],
    noSessionLog: true,
    trustWorkspace: true,
  }
  const resolveCtx = {
    subprocess: { resolveExecutable: async (command: string) => command },
  }
  const signal = new AbortController().signal

  // Native invocation injects the parent session id and preserves other vars.
  const nativeConfig = {
    ...baseExec,
    runtime: 'native',
    command: 'muse',
    env: { KEEP_ME: 'kept', DSH_SESSION_ID: 'spoofed' },
  }
  const native = await resolveInvocation(
    resolveCtx, nativeConfig as unknown as InvocationConfig, '/workspace', '/tmp/prompt.txt',
    signal, 'danger-full-access', withSession({ id: sessionId, cwd: '/workspace' }),
  )
  assert.equal(native.env.DSH_SESSION_ID, sessionId)
  assert.equal(native.env.KEEP_ME, 'kept')
  assert.equal(nativeConfig.env.DSH_SESSION_ID, 'spoofed')

  // WSL invocation injects the same id and forwards it through WSLENV.
  const wslConfig = {
    ...baseExec,
    runtime: 'wsl',
    wslExecutable: 'wsl.exe',
    wslDistribution: 'Ubuntu',
    wslCommand: 'muse',
    env: { KEEP_ME: 'kept', DSH_SESSION_ID: 'spoofed' },
  }
  const wsl = await resolveInvocation(
    resolveCtx, wslConfig as unknown as InvocationConfig, 'C:\\work\\repo', 'C:\\Temp\\prompt.txt',
    signal, 'danger-full-access', withSession({ id: sessionId, cwd: 'C:\\work\\repo' }),
  )
  assert.equal(wsl.env.DSH_SESSION_ID, sessionId)
  assert.equal(wsl.env.KEEP_ME, 'kept')
  assert(wsl.env.WSLENV.split(':').includes('DSH_SESSION_ID'))
  assert(wsl.env.WSLENV.split(':').includes('KEEP_ME'))
  assert.equal(wslConfig.env.DSH_SESSION_ID, 'spoofed')

  // Missing session id strips a configured spoof instead of leaking it.
  const stripped = await resolveInvocation(
    resolveCtx, nativeConfig as unknown as InvocationConfig, '/workspace', '/tmp/prompt.txt',
    signal, 'danger-full-access', withSession({ cwd: '/workspace' }),
  )
  assert.equal(stripped.env.DSH_SESSION_ID, undefined)
  assert.equal(stripped.env.KEEP_ME, 'kept')

  // Native end-to-end wiring through startMuseRun uses the request session id.
  const runConfig = {
    ...baseExec,
    providerName: 'muse',
    runtime: 'native',
    command: 'muse',
    env: { KEEP_ME: 'kept', DSH_SESSION_ID: 'spoofed' },
    disposeGraceMs: 3000,
  }
  let spawned!: SpawnSpec
  const runCtx = {
    logger: { warn() {} },
    subprocess: {
      resolveExecutable: async (command: string) => command,
      spawn(spec: SpawnSpec) {
        spawned = spec
        const stdout = new PassThrough()
        const stderr = new PassThrough()
        queueMicrotask(() => {
          stdout.end(JSON.stringify({ payload: { kind: 'run_terminal', terminal: 'completed', text: 'ok' } }) + '\n')
          stderr.end()
        })
        return {
          stdout,
          stderr,
          done: Promise.resolve({ exitCode: 0, signal: null }),
          terminate() {},
          waitForExit: async () => true,
        }
      },
    },
  }
  const run = await startMuseRun(
    runCtx as unknown as RunContext,
    {
      prompt: [{ type: 'text', text: 'ping' }],
      parent: { session: { header: { id: sessionId, cwd: process.cwd() } } },
      signal: new AbortController().signal,
    } as unknown as MuseRequest,
    runConfig as unknown as RunConfig,
    process.cwd(),
    'danger-full-access',
  )
  try {
    assert.equal(spawned.env.DSH_SESSION_ID, sessionId)
    assert.equal(spawned.env.KEEP_ME, 'kept')
    assert.equal(runConfig.env.DSH_SESSION_ID, 'spoofed')
    const result = await run.result
    assert.equal(result.stopReason, 'completed')
  } finally {
    await run.dispose()
  }
})
