import * as fs from 'fs';
import * as path from 'path';
import { CollectedConfig } from '../core/types';

const CACHE_FILE = '.deploy-setup-cache.json';

export function saveCache(dir: string, config: CollectedConfig): void {
  fs.writeFileSync(path.join(dir, CACHE_FILE), JSON.stringify(config, null, 2), 'utf-8');
}

export function loadCache(dir: string): CollectedConfig {
  const file = path.join(dir, CACHE_FILE);
  if (!fs.existsSync(file)) {
    throw new Error(`未找到配置缓存，请先运行 deploy-setup init`);
  }
  return JSON.parse(fs.readFileSync(file, 'utf-8'));
}
