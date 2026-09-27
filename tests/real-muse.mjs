import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { join } from 'node:path'
import { startMuseRun } from '../runtime.js'

const NONCE = `DSH_MUSE_PROVIDER_OK_${Date.now()}`

function localHandle(spec) {
  const child = spawn(spec.argv[0], spec.argv.slice(1), {
    cwd: spec.cwd,
    env: { ...process.env, ...spec.env },
    stdio: [spec.stdio.stdin, spec.stdio.stdout, spec.stdio.stderr],
    windowsHide: true,
  })
  let settled = false
  const done = new Promise((resolve, reject) => {
    child.once('error', reject)
    child.once('close', (exitCode, signal) => {
      settled = true
      resolve({ exitCode, signal })
    })
  })
  return {
    stdin: child.stdin,
    stdout: child.stdout,
    stderr: child.stderr,
    done,
    terminate() {
      if (!settled) child.kill()
    },
    async waitForExit(signal) {
      if (settled) return true
      if (!signal) {
        await done
        return true
      }
      return await Promise.race([
        done.then(() => true),
        new Promise(resolve => signal.addEventListener('abort', () => resolve(false), { once: true })),
      ])
    },
  }
}

const controller = new AbortController()
const timeout = setTimeout(() => controller.abort(new Error('real Muse test timed out')), 180_000)

const ctx = {
  logger: { warn: message => process.stderr.write(`${message}\n`) },
  subprocess: {
    async resolveExecutable(command) {
      if (command === 'muse') throw new Error('native Muse intentionally absent in this Windows test')
      if (command.toLowerCase() === 'wsl.exe') return join(process.env.WINDIR ?? 'C:\\Windows', 'System32', 'wsl.exe')
      return command
    },
    spawn: localHandle,
  },
}

const config = {
  providerName: 'muse',
  runtime: 'auto',
  command: 'muse',
  wslExecutable: 'wsl.exe',
  wslDistribution: 'Ubuntu',
  wslCommand: 'muse',
  approvalMode: 'never',
  trustWorkspace: true,
  noSessionLog: true,
  extraArgs: [],
  env: {},
  disposeGraceMs: 3_000,
}

let run
try {
  run = await startMuseRun(ctx, {
    parent: { session: { header: { cwd: process.cwd() } } },
    prompt: [{ type: 'text', text: `Reply with exactly: ${NONCE}` }],
    signal: controller.signal,
  }, config, process.cwd(), 'workspace-write')
  const result = await run.result
  assert.equal(result.stopReason, 'completed')
  assert.equal(result.output.length, 1)
  assert.equal(result.output[0].type, 'text')
  assert.equal(result.output[0].text.trim(), NONCE)
  process.stdout.write(`${JSON.stringify(result)}\n`)
} finally {
  clearTimeout(timeout)
  await run?.dispose()
}
