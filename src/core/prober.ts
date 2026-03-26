import { execSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import { ServerConfig, ProbeResult } from './types';

/**
 * SSH to the server and probe its capabilities.
 * Returns a ProbeResult describing hardware, software, and network conditions.
 */
export function probeServer(server: ServerConfig): ProbeResult {
  const resolvedKeyPath = (server.sshKeyPath || '~/.ssh/id_rsa').replace(/^~/, os.homedir());
  const keyArg = fs.existsSync(resolvedKeyPath) ? `-i "${resolvedKeyPath}"` : '';
  const sshBase = `ssh -o StrictHostKeyChecking=no -o ConnectTimeout=15 ${keyArg} ${server.user}@${server.host}`;

  const script = `
    echo "===MEMORY==="
    free -m 2>/dev/null | awk '/Mem:/{print $2}' || echo "0"
    echo "===CPU==="
    nproc 2>/dev/null || echo "1"
    echo "===DISK==="
    df -BG / 2>/dev/null | tail -1 | awk '{gsub("G",""); print $4}' || echo "0"
    echo "===DOCKER==="
    command -v docker &>/dev/null && echo "yes" || echo "no"
    echo "===COMPOSE==="
    docker compose version &>/dev/null && echo "yes" || echo "no"
    echo "===DOCKERHUB==="
    curl -s --connect-timeout 5 https://registry-1.docker.io/v2/ &>/dev/null && echo "reachable" || echo "blocked"
    echo "===NPM==="
    curl -s --connect-timeout 5 https://registry.npmjs.org/ &>/dev/null && echo "reachable" || echo "blocked"
    echo "===ALPINE==="
    curl -s --connect-timeout 5 https://dl-cdn.alpinelinux.org/alpine/ &>/dev/null && echo "reachable" || echo "blocked"
    echo "===GEO==="
    curl -s --connect-timeout 5 ipinfo.io/country 2>/dev/null || echo "UNKNOWN"
  `.trim();

  let output: string;
  const tmpScript = require('path').join(os.tmpdir(), `deploy_probe_${Date.now()}.sh`);
  try {
    fs.writeFileSync(tmpScript, script, 'utf-8');
    output = execSync(`${sshBase} "bash -s" < "${tmpScript}"`, {
      encoding: 'utf-8',
      timeout: 60000,
    });
    if (fs.existsSync(tmpScript)) fs.unlinkSync(tmpScript);
  } catch (err: any) {
    if (fs.existsSync(tmpScript)) fs.unlinkSync(tmpScript);
    // If SSH fails, return conservative defaults
    console.warn(`Server probe failed: ${err.message}. Using conservative defaults.`);
    return {
      memoryMB: 0,
      cpuCores: 1,
      diskFreeGB: 0,
      dockerInstalled: false,
      dockerComposeInstalled: false,
      dockerHubReachable: false,
      npmReachable: false,
      alpineReachable: false,
      geoCountry: 'UNKNOWN',
      needsChinaMirrors: false,
    };
  }

  const getSection = (name: string): string => {
    const regex = new RegExp(`===${name}===\\s*([^=]*?)(?:===|$)`);
    const match = output.match(regex);
    return match ? match[1].trim() : '';
  };

  const geo = getSection('GEO').trim().toUpperCase();

  return {
    memoryMB: parseInt(getSection('MEMORY')) || 0,
    cpuCores: parseInt(getSection('CPU')) || 1,
    diskFreeGB: parseInt(getSection('DISK')) || 0,
    dockerInstalled: getSection('DOCKER') === 'yes',
    dockerComposeInstalled: getSection('COMPOSE') === 'yes',
    dockerHubReachable: getSection('DOCKERHUB') === 'reachable',
    npmReachable: getSection('NPM') === 'reachable',
    alpineReachable: getSection('ALPINE') === 'reachable',
    geoCountry: geo,
    needsChinaMirrors: geo === 'CN' || (!getSection('DOCKERHUB').includes('reachable') && !getSection('NPM').includes('reachable')),
  };
}
