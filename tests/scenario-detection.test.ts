import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import { detectScenario } from '../src/core/detector'

describe('detectScenario', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'scenario-test-'))
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('detects tauri-desktop when src-tauri/Cargo.toml + tauri.conf.json exist', () => {
    const tauriDir = path.join(tmpDir, 'src-tauri')
    fs.mkdirSync(tauriDir, { recursive: true })
    fs.writeFileSync(path.join(tauriDir, 'Cargo.toml'), '[package]\nname = "test"')
    fs.writeFileSync(path.join(tauriDir, 'tauri.conf.json'), '{}')

    expect(detectScenario(tmpDir)).toBe('tauri-desktop')
  })

  it('detects tauri-desktop with nested apps/desktop/src-tauri layout', () => {
    const tauriDir = path.join(tmpDir, 'apps', 'desktop', 'src-tauri')
    fs.mkdirSync(tauriDir, { recursive: true })
    fs.writeFileSync(path.join(tauriDir, 'Cargo.toml'), '[package]\nname = "test"')
    fs.writeFileSync(path.join(tauriDir, 'tauri.conf.json'), '{}')

    expect(detectScenario(tmpDir)).toBe('tauri-desktop')
  })

  it('detects monorepo-node when pnpm-workspace.yaml + apps/server + apps/admin exist', () => {
    fs.writeFileSync(path.join(tmpDir, 'pnpm-workspace.yaml'), 'packages:\n  - apps/*')
    fs.mkdirSync(path.join(tmpDir, 'apps', 'server'), { recursive: true })
    fs.mkdirSync(path.join(tmpDir, 'apps', 'admin'), { recursive: true })

    expect(detectScenario(tmpDir)).toBe('monorepo-node')
  })

  it('falls back to simple-web for a basic project', () => {
    fs.writeFileSync(path.join(tmpDir, 'package.json'), '{"name": "test"}')

    expect(detectScenario(tmpDir)).toBe('simple-web')
  })

  it('prefers tauri-desktop over monorepo-node when both signals present', () => {
    // Tauri monorepo (like VibeCraft)
    fs.writeFileSync(path.join(tmpDir, 'pnpm-workspace.yaml'), 'packages:\n  - apps/*')
    fs.mkdirSync(path.join(tmpDir, 'apps', 'server'), { recursive: true })
    fs.mkdirSync(path.join(tmpDir, 'apps', 'admin'), { recursive: true })
    const tauriDir = path.join(tmpDir, 'apps', 'desktop', 'src-tauri')
    fs.mkdirSync(tauriDir, { recursive: true })
    fs.writeFileSync(path.join(tauriDir, 'Cargo.toml'), '[package]\nname = "vibecraft"')
    fs.writeFileSync(path.join(tauriDir, 'tauri.conf.json'), '{}')

    expect(detectScenario(tmpDir)).toBe('tauri-desktop')
  })

  it('returns simple-web when pnpm-workspace exists but no apps/server', () => {
    fs.writeFileSync(path.join(tmpDir, 'pnpm-workspace.yaml'), 'packages:\n  - packages/*')
    fs.mkdirSync(path.join(tmpDir, 'packages', 'foo'), { recursive: true })

    expect(detectScenario(tmpDir)).toBe('simple-web')
  })
})
