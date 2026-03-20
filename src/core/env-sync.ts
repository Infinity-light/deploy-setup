import { CollectedConfig } from './types';

export interface EnvDiff {
  added: string[];
  removed: string[];
  unchanged: string[];
}

export function diffEnvKeys(currentKeys: string[], cachedConfig: CollectedConfig): EnvDiff {
  const cachedAllKeys = new Set([
    ...Object.keys(cachedConfig.envVars || {}),
    ...(cachedConfig.secrets || []),
  ]);

  const currentSet = new Set(currentKeys);

  const added: string[] = [];
  const removed: string[] = [];
  const unchanged: string[] = [];

  for (const key of currentKeys) {
    if (cachedAllKeys.has(key)) {
      unchanged.push(key);
    } else {
      added.push(key);
    }
  }

  for (const key of cachedAllKeys) {
    if (!currentSet.has(key)) {
      removed.push(key);
    }
  }

  return { added, removed, unchanged };
}

export function buildEnvBlock(envVars: Record<string, string>, secrets: string[]): string {
  const indent = '            ';
  const lines: string[] = [];

  // heredoc block for hardcoded vars
  lines.push(`${indent}cat > .env << 'ENVEOF'`);
  for (const [key, value] of Object.entries(envVars)) {
    lines.push(`${indent}${key}=${value}`);
  }
  lines.push(`${indent}ENVEOF`);
  lines.push(`${indent}sed -i 's/^ *//' .env`);

  // secret lines appended via echo
  for (const key of secrets) {
    lines.push(`${indent}echo "${key}=\${{ secrets.${key} }}" >> .env`);
  }

  return lines.join('\n');
}

export function patchDeployYml(content: string, envVars: Record<string, string>, secrets: string[]): string {
  const startMarker = '# Generate complete .env';
  const endMarker = 'docker compose pull';

  const startIdx = content.indexOf(startMarker);
  if (startIdx === -1) {
    throw new Error(`deploy.yml 中未找到标记: "${startMarker}"\n请确保 workflow 文件包含此注释行`);
  }

  const endIdx = content.indexOf(endMarker, startIdx);
  if (endIdx === -1) {
    throw new Error(`deploy.yml 中未找到标记: "${endMarker}"\n请确保 workflow 文件包含 docker compose pull 行`);
  }

  const indent = '            ';
  const newBlock = `${startMarker}\n${buildEnvBlock(envVars, secrets)}\n\n${indent}`;

  return content.slice(0, startIdx) + newBlock + content.slice(endIdx);
}
