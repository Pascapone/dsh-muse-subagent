import assert from 'node:assert/strict'
import test from 'node:test'
import { apply, ORIGINAL_DESCRIPTION, ORIGINAL_PROMPT_DESCRIPTION, toolWording } from '../tool-platform.js'

test('tool wording adds WSL context only on Windows', () => {
  const windows = toolWording('win32')
  assert.equal(windows.description.startsWith(ORIGINAL_DESCRIPTION), true)
  assert.match(windows.description, /runs only inside WSL/)
  assert.match(windows.description, /\/mnt\/c\/\.\.\./)
  assert.match(windows.description, /Linux environment/)
  assert.match(windows.promptDescription, /WSL\/Linux paths/)

  for (const platform of ['linux', 'darwin']) {
    assert.equal(toolWording(platform).description.startsWith(ORIGINAL_DESCRIPTION), true)
    assert.match(toolWording(platform).description, /full-access Agents start unrestricted/)
    assert.equal(toolWording(platform).promptDescription, ORIGINAL_PROMPT_DESCRIPTION)
  }
})

test('Muse tool registers and executes a foreground run', async () => {
  let definition
  let disposed = false
  const ctx = {
    tools: {
      register(value) {
        definition = value
        return () => {}
      },
    },
    subagents: {
      async start(provider, request) {
        assert.equal(provider, 'muse')
        assert.equal(request.prompt[0].text, 'do the task')
        assert.deepEqual(request.museOptions, { sandboxed: true, workspace: '/slot' })
        return {
          id: 'muse-test-run',
          result: Promise.resolve({
            output: [{ type: 'text', text: 'done' }],
            stopReason: 'completed',
          }),
          async dispose() { disposed = true },
        }
      },
    },
    get() { return undefined },
  }

  apply(ctx, { provider: 'muse', toolName: 'subagent_muse' })
  assert.match(definition.description, /runs only inside WSL/)
  assert.match(definition.description, /\/mnt\/c\/\.\.\./)
  assert.match(definition.description, /Linux environment/)
  assert.match(definition.parameters.properties.prompt.description, /WSL\/Linux paths/)

  const value = await definition.execute(
    { description: 'test task', prompt: 'do the task', sandboxed: true, workspace: '/slot' },
    { agent: { id: 'parent' }, signal: new AbortController().signal },
  )
  assert.deepEqual(value, {
    kind: 'foreground',
    runId: 'muse-test-run',
    output: [{ type: 'text', text: 'done' }],
  })
  assert.equal(disposed, true)
})
