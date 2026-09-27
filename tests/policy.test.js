import assert from 'node:assert/strict'
import test from 'node:test'
import { PassThrough } from 'node:stream'
import { tmpdir } from 'node:os'
import { apply } from '../main.js'

function harness(mode) {
  let provider, tool, spawned
  const ctx = {
    sandboxPolicy: { resolve: ({ session }) => {
      assert.equal(session.header.cwd, process.cwd())
      return { mode, workspaceRoot: session.header.cwd }
    } },
    subagents: {
      registerProvider(value) { provider = value },
      start(_name, request) { return provider.start(request) },
    },
    subprocess: {
      resolveExecutable: async command => command,
      spawn(spec) {
        spawned = spec
        const stdout = new PassThrough()
        const stderr = new PassThrough()
        queueMicrotask(() => {
          stdout.end(JSON.stringify({ payload: { kind: 'run_terminal', terminal: 'completed', text: 'ok' } }) + '\n')
          stderr.end()
        })
        return { stdout, stderr, done: Promise.resolve({ exitCode: 0, signal: null }),
          terminate() {}, waitForExit: async () => true }
      },
    },
    tools: { register(value) { tool = value } },
    logger: { warn() {} },
  }
  apply(ctx, {})
  const exec = { agent: { id: 'test', session: { header: { cwd: process.cwd() } } }, signal: new AbortController().signal }
  const call = options => tool.execute({ description: 'policy test', prompt: 'ping', ...options }, exec)
  return { call, get spawned() { return spawned } }
}

test('parent policy controls Muse launch arguments and workspace selection', async () => {
  for (const mode of ['danger-full-access', 'workspace-write', 'read-only']) {
    const h = harness(mode)
    assert.equal((await h.call({})).output[0].text, 'ok')
    assert.equal(h.spawned.argv.includes('--yolo'), mode === 'danger-full-access')
    if (mode === 'workspace-write') assert(h.spawned.argv.includes('--approval-mode'))
    if (mode === 'read-only') assert(h.spawned.argv.includes(':read-only'))
    if (mode !== 'danger-full-access') {
      await assert.rejects(() => h.call({ sandboxed: false }), /cannot disable/)
      await assert.rejects(() => h.call({ workspace: process.cwd() }), /only full-access/)
    }
  }
  const full = harness('danger-full-access')
  await full.call({ sandboxed: true, workspace: tmpdir() })
  assert.equal(full.spawned.cwd, tmpdir())
  assert(!full.spawned.argv.includes('--yolo'))
  assert(full.spawned.argv.includes('--approval-mode'))
  await assert.rejects(() => full.call({ workspace: 'relative' }), /absolute path/)
})
