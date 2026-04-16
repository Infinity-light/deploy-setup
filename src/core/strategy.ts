import chalk from 'chalk';
import { ProbeResult, DeployStrategy, DetectionResult, ProxyRepoConfig } from './types';

const CHINA_MIRRORS = {
  alpine: 'mirrors.aliyun.com',
  npm: 'registry.npmmirror.com',
  pip: 'mirrors.aliyun.com/pypi/simple',
  docker: ['docker.1panel.live', 'hub.rat.dev'],
};

export interface StrategyOptions {
  legacy?: boolean;
  repoOwner?: string;
  repoName?: string;
}

/**
 * Derive proxy repo config.
 * Default: enabled=true, repo = "{repoName}-releases".
 * --legacy: enabled=false.
 */
export function deriveProxyRepoConfig(options: StrategyOptions): ProxyRepoConfig {
  if (options.legacy) {
    return {
      enabled: false,
      owner: '',
      repo: '',
      eventType: '',
      checkoutTokenSecret: '',
    };
  }

  const owner = options.repoOwner || '';
  const baseRepo = options.repoName || '';
  return {
    enabled: true,
    owner,
    repo: `${baseRepo}-releases`,
    eventType: 'deploy',
    checkoutTokenSecret: 'GH_RELEASE_REPO_TOKEN',
  };
}

/**
 * Based on server probe results and project detection,
 * select the optimal deployment strategy.
 */
export function selectStrategy(probe: ProbeResult, detection: DetectionResult): DeployStrategy {
  const needsBuildTools = (detection.nativeModules || []).length > 0;

  // Determine if we should build on CI
  // Reasons to build on CI:
  // 1. Server has less than 4GB memory (building with native modules needs memory)
  // 2. Server can't reach Docker Hub (can't pull base images)
  // 3. Server can't reach npm/Alpine repos (can't install deps during build)
  const lowMemory = probe.memoryMB > 0 && probe.memoryMB < 4096;
  const networkBlocked = !probe.dockerHubReachable || !probe.npmReachable;
  const buildOnCI = lowMemory || networkBlocked;

  const strategy: DeployStrategy = {
    buildLocation: buildOnCI ? 'ci' : 'server',
    transferMethod: buildOnCI ? 'scp' : 'none',
    mirrors: {},
    needsBuildTools,
    deployTimeoutMinutes: 15,
  };

  // Configure mirrors for China
  if (probe.needsChinaMirrors) {
    strategy.mirrors = { ...CHINA_MIRRORS };
  } else {
    // Even if not in China, if specific repos are blocked, add mirrors
    if (!probe.alpineReachable) strategy.mirrors.alpine = CHINA_MIRRORS.alpine;
    if (!probe.npmReachable) strategy.mirrors.npm = CHINA_MIRRORS.npm;
  }

  // Bump deploy timeout when we expect slower pulls or longer rebuilds:
  //   - China mirrors (proxy adds latency, docker compose pulls via 1panel/rat can take minutes)
  //   - Resource-constrained server (native module compilation during `docker compose up`
  //     on 1-2GB/1-core boxes regularly exceeds 15min)
  const constrained =
    (probe.memoryMB > 0 && probe.memoryMB < 2048) ||
    (probe.cpuCores > 0 && probe.cpuCores < 2);
  if (probe.needsChinaMirrors || constrained) {
    strategy.deployTimeoutMinutes = 25;
  }

  // Log the decision
  console.log(chalk.cyan('\n📊 部署策略决策:'));
  console.log(chalk.gray(`  服务器: ${probe.memoryMB}MB RAM, ${probe.cpuCores} CPU, ${probe.diskFreeGB}GB disk`));
  console.log(chalk.gray(`  Docker Hub: ${probe.dockerHubReachable ? '可达' : '不可达'}`));
  console.log(chalk.gray(`  npm: ${probe.npmReachable ? '可达' : '不可达'}`));
  console.log(chalk.gray(`  地区: ${probe.geoCountry}`));
  console.log(chalk.gray(`  原生模块: ${needsBuildTools ? (detection.nativeModules || []).join(', ') : '无'}`));

  if (buildOnCI) {
    const reasons: string[] = [];
    if (lowMemory) reasons.push(`内存不足 (${probe.memoryMB}MB < 4096MB)`);
    if (networkBlocked) reasons.push('网络受限');
    console.log(chalk.yellow(`  → CI 构建 + SCP 传输 (原因: ${reasons.join(', ')})`));
  } else {
    console.log(chalk.green('  → 服务器本地构建'));
  }

  if (Object.keys(strategy.mirrors).length > 0) {
    console.log(chalk.gray(`  镜像源: ${JSON.stringify(strategy.mirrors)}`));
  }

  console.log(
    chalk.gray(
      `  CI deploy timeout: ${strategy.deployTimeoutMinutes}min` +
        (strategy.deployTimeoutMinutes === 25
          ? ' (提升：' +
            (probe.needsChinaMirrors ? '中国镜像拉取延迟 ' : '') +
            (constrained ? `资源受限 ${probe.memoryMB}MB/${probe.cpuCores}core` : '') +
            ')'
          : ''),
    ),
  );

  return strategy;
}
