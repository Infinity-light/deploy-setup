import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { GlobalConfig, ServerConfig } from '../core/types';

const CONFIG_DIR = path.join(os.homedir(), '.deploy-setup');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');

function ensureDir(): void {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
  }
}

export function loadGlobalConfig(): GlobalConfig {
  ensureDir();
  if (!fs.existsSync(CONFIG_FILE)) {
    return { servers: {}, projects: {} };
  }
  return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'));
}

export function saveGlobalConfig(config: GlobalConfig): void {
  ensureDir();
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf-8');
}

export function getSavedServers(): Record<string, ServerConfig> {
  return loadGlobalConfig().servers;
}

export function saveServer(name: string, server: ServerConfig): void {
  const config = loadGlobalConfig();
  config.servers[name] = server;
  saveGlobalConfig(config);
}

export function saveProjectRecord(name: string, type: string): void {
  const config = loadGlobalConfig();
  config.projects[name] = { type: type as any, lastDeploy: new Date().toISOString() };
  saveGlobalConfig(config);
}
