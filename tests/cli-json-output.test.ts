import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { redirectConsoleToStderr } from '../src/utils/json-output'
import { EXIT_SUCCESS, EXIT_CONFIG_ERROR, EXIT_NETWORK_ERROR, EXIT_SECRET_MISSING, EXIT_PROXY_REPO_FAILED } from '../src/core/types'

describe('Exit code constants', () => {
  it('defines all expected exit codes', () => {
    expect(EXIT_SUCCESS).toBe(0)
    expect(EXIT_CONFIG_ERROR).toBe(1)
    expect(EXIT_NETWORK_ERROR).toBe(2)
    expect(EXIT_SECRET_MISSING).toBe(3)
    expect(EXIT_PROXY_REPO_FAILED).toBe(4)
  })
})

describe('redirectConsoleToStderr', () => {
  let originalLog: typeof console.log
  let originalInfo: typeof console.info
  let originalWarn: typeof console.warn
  let stderrSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    originalLog = console.log
    originalInfo = console.info
    originalWarn = console.warn
    stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
  })

  afterEach(() => {
    console.log = originalLog
    console.info = originalInfo
    console.warn = originalWarn
    stderrSpy.mockRestore()
  })

  it('redirects console.log to stderr', () => {
    redirectConsoleToStderr()
    console.log('test message')
    expect(stderrSpy).toHaveBeenCalledWith('test message\n')
  })

  it('redirects console.info to stderr', () => {
    redirectConsoleToStderr()
    console.info('info message')
    expect(stderrSpy).toHaveBeenCalledWith('info message\n')
  })

  it('redirects console.warn to stderr', () => {
    redirectConsoleToStderr()
    console.warn('warn message')
    expect(stderrSpy).toHaveBeenCalledWith('warn message\n')
  })
})

describe('ProxyRepoConfig and Scenario types', () => {
  it('Scenario type accepts valid values', () => {
    // Type-level test — if this compiles, the types are correct
    const scenarios: import('../src/core/types').Scenario[] = [
      'simple-web',
      'monorepo-node',
      'tauri-desktop',
    ]
    expect(scenarios).toHaveLength(3)
  })

  it('ProxyRepoConfig has correct shape', () => {
    const config: import('../src/core/types').ProxyRepoConfig = {
      enabled: true,
      owner: 'test-owner',
      repo: 'test-repo-releases',
      eventType: 'deploy',
      checkoutTokenSecret: 'GH_RELEASE_REPO_TOKEN',
    }
    expect(config.enabled).toBe(true)
    expect(config.repo).toBe('test-repo-releases')
  })
})
