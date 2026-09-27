import assert from 'node:assert/strict'
import test from 'node:test'
import {
  applyMuseJsonLine,
  createOutputState,
  museExecArguments,
  textTask,
  windowsPathToWsl,
  windowsPathToWslDetails,
} from '../runtime.js'

test('textTask accepts text only and preserves order', () => {
  assert.equal(textTask([{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }]), 'ab')
  assert.throws(() => textTask([]), /text blocks/)
  assert.throws(() => textTask([{ type: 'text', text: '   ' }]), /must not be empty/)
  assert.throws(() => textTask([{ type: 'image' }]), /text blocks/)
})

test('windowsPathToWsl maps drive and UNC paths', () => {
  assert.equal(windowsPathToWsl('C:\\work\\repo', 'Ubuntu'), '/mnt/c/work/repo')
  assert.equal(
    windowsPathToWsl('\\\\wsl.localhost\\Ubuntu\\home\\me\\repo', 'Ubuntu'),
    '/home/me/repo',
  )
  assert.deepEqual(
    windowsPathToWslDetails('\\\\wsl.localhost\\Ubuntu\\home\\me\\repo'),
    { path: '/home/me/repo', distribution: 'Ubuntu' },
  )
  assert.throws(
    () => windowsPathToWsl('\\\\wsl$\\Debian\\home\\me', 'Ubuntu'),
    /not Ubuntu/,
  )
})

test('Muse JSONL parser collects deltas and authoritative terminal text', () => {
  const state = createOutputState()
  applyMuseJsonLine(JSON.stringify({ payload: { kind: 'run_output_delta', text: 'hello ' } }), state)
  applyMuseJsonLine(JSON.stringify({ payload: { kind: 'run_output_delta', text: 'world' } }), state)
  applyMuseJsonLine(JSON.stringify({
    payload: { kind: 'run_terminal', terminal: 'completed', text: 'hello world' },
  }), state)
  assert.equal(state.deltaChunks.join(''), 'hello world')
  assert.equal(state.terminal, 'completed')
  assert.equal(state.terminalText, 'hello world')
  assert.throws(() => applyMuseJsonLine('{bad', state), /invalid JSONL/)
})

test('Muse JSONL parser rejects oversized records and answers', () => {
  const state = createOutputState()
  assert.throws(
    () => applyMuseJsonLine('x'.repeat(16 * 1024 * 1024 + 1), state),
    /record exceeded/,
  )
  assert.throws(
    () => applyMuseJsonLine(JSON.stringify({
      payload: { kind: 'run_output_delta', text: 'x'.repeat(8 * 1024 * 1024 + 1) },
    }), state),
    /answer exceeded/,
  )
})

test('CLI arguments enforce JSON, safe approval, workspace and prompt file', () => {
  const args = museExecArguments({
    approvalMode: 'never',
    env: {},
    extraArgs: [],
    noSessionLog: true,
    trustWorkspace: true,
  }, '/workspace', '/tmp/prompt.txt', 'workspace-write')
  assert.deepEqual(args, [
    'exec', '--json', '--no-session-log', '--approval-mode', 'never',
    '--trust-workspace', '--workspace', '/workspace', '--prompt-file', '/tmp/prompt.txt',
  ])
  const config = { approvalMode: 'never', extraArgs: [], noSessionLog: true, trustWorkspace: true }
  const full = museExecArguments(config, '/slot', '/tmp/prompt', 'danger-full-access')
  assert(full.includes('--yolo'))
  assert(!full.includes('--approval-mode'))
  assert.deepEqual(museExecArguments(config, '/slot', '/tmp/prompt', 'read-only').slice(0, 7), [
    'exec', '--json', '--no-session-log', '--permission-profile', ':read-only', '--disable-shell', '--disable-write',
  ])
  assert.throws(() => museExecArguments({ ...config, extraArgs: ['--yolo'] }, '/slot', '/tmp/prompt', 'workspace-write'), /extraArgs/)
  assert.throws(() => museExecArguments({ ...config, approvalMode: 'on-request' }, '/slot', '/tmp/prompt', 'workspace-write'), /approvalMode never/)
  assert.throws(() => museExecArguments(config, '/slot', '/tmp/prompt', 'unknown'), /unsupported file policy/)
})
