import test from 'node:test'
import assert from 'node:assert/strict'
import { PassThrough } from 'node:stream'
import { access } from 'node:fs/promises'
import { dirname } from 'node:path'
import { startMuseRun, applyMuseJsonLine, createOutputState, textTask } from '../runtime.js'
import type { MuseRequest, RunConfig, RunContext } from '../types.js'

test('unknown JSONL and task values are narrowed before use', () => {
  const state = createOutputState()
  for (const value of [null, false, 1, 'text', [], {}, { payload: null }, { payload: 'text' }]) applyMuseJsonLine(JSON.stringify(value), state)
  assert.deepEqual(state.deltaChunks, [])
  assert.throws(() => applyMuseJsonLine(JSON.stringify({ payload: { kind: 'run_terminal', terminal: 1 } }), state), /terminal value/)
  for (const value of [null, 'text', [null], [1], [{ type: 'text', text: false }]]) assert.throws(() => textTask(value), /text blocks/)
})

test('aborted Muse run disposes its owned streams and prompt directory', async () => {
  const stdout = new PassThrough(), stderr = new PassThrough(), signal = new AbortController()
  let finish!: (value: { exitCode: number; signal: null }) => void, promptFile = '', terminated = false
  const done = new Promise<{ exitCode: number; signal: null }>(resolve => { finish = resolve })
  const ctx = {
    logger: { warn() {} }, subprocess: {
      resolveExecutable: async (command: string) => command,
      spawn(spec: { argv: string[] }) {
        promptFile = spec.argv.at(-1)!
        return { stdout, stderr, done, terminate() { terminated = true; stdout.end(); stderr.end(); finish({ exitCode: 0, signal: null }) }, waitForExit: async () => { await done; return true } }
      },
    },
  } as unknown as RunContext
  const config: RunConfig = { providerName: 'muse', runtime: 'native', command: 'muse', wslExecutable: 'wsl.exe', wslCommand: 'muse', extraArgs: [], approvalMode: 'never', disposeGraceMs: 3000 }
  const run = await startMuseRun(ctx, { prompt: [{ type: 'text', text: 'ping' }], signal: signal.signal } as MuseRequest, config, process.cwd(), 'workspace-write')
  try { signal.abort(); assert.equal((await run.result).stopReason, 'aborted') }
  finally { await run.dispose() }
  assert.equal(terminated, true)
  await assert.rejects(access(dirname(promptFile)), { code: 'ENOENT' })
})
