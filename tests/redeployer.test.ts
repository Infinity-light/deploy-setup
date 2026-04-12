import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as fs from 'node:fs'
import * as childProcess from 'node:child_process'
import * as path from 'node:path'
import * as os from 'node:os'

// Mock execSync so tests don't actually call gh
vi.mock('node:child_process', () => ({
  execSync: vi.fn(),
}))

import { redeployProject } from '../src/core/redeployer'

describe('redeployProject', () => {
  let tmpDir: string
  let configPath: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'redeploy-test-'))
    configPath = path.join(tmpDir, 'config.json')
    vi.clearAllMocks()
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('throws when config does not exist', async () => {
    await expect(
      redeployProject({ configPath: path.join(tmpDir, 'missing.json') })
    ).rejects.toThrow('不存在')
  })

  it('uses cfg.ci.workflowFile when present', async () => {
    fs.writeFileSync(
      configPath,
      JSON.stringify({ ci: { workflowFile: 'deploy.yml' } })
    )
    await redeployProject({ configPath })
    expect(childProcess.execSync).toHaveBeenCalledWith(
      'gh workflow run deploy.yml',
      expect.anything()
    )
  })

  it('uses --workflow option over cfg.ci.workflowFile', async () => {
    fs.writeFileSync(
      configPath,
      JSON.stringify({ ci: { workflowFile: 'deploy.yml' } })
    )
    await redeployProject({ configPath, workflow: 'custom-deploy.yml' })
    expect(childProcess.execSync).toHaveBeenCalledWith(
      'gh workflow run custom-deploy.yml',
      expect.anything()
    )
  })

  it('throws when no workflowFile in config and no candidate files found', async () => {
    fs.writeFileSync(configPath, JSON.stringify({}))
    // No .github/workflows/deploy*.yml exist in cwd (test runner dir)
    // detectDeployWorkflow will throw
    await expect(
      redeployProject({ configPath })
    ).rejects.toThrow('未找到')
  })
})
