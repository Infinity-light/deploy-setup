import * as fs from 'fs';
import * as path from 'path';
import chalk from 'chalk';
import { CollectedConfig } from './types';
import { replacePlaceholders, readTemplate } from '../utils/template';

interface GeneratedFile {
  path: string;
  backedUp: boolean;
}

export function generateFiles(config: CollectedConfig, outputDir: string): GeneratedFile[] {
  const generated: GeneratedFile[] = [];

  // Check if this is proxy-service with existing-compose mode
  const isProxyService = config.project.type === 'proxy-service';
  const isExistingCompose = config.deploymentMode === 'existing-compose';
  const skipDockerFiles = isProxyService && isExistingCompose;

  const vars = buildTemplateVars(config, skipDockerFiles);

  if (!skipDockerFiles) {
    // Dockerfile
    generated.push(writeTemplate(
      getDockerfileTemplate(config.project.type, config.project.projectStructure),
      'Dockerfile',
      vars, outputDir
    ));

    // .dockerignore
    const ignoreCategory = config.project.language === 'python' ? 'python' : 'node';
    generated.push(writeTemplate(
      readTemplate('dockerignore', `${ignoreCategory}.dockerignore`),
      '.dockerignore',
      vars, outputDir
    ));

    // docker-compose.yml
    generated.push(writeTemplate(
      readTemplate('compose', 'default.yml'),
      'docker-compose.yml',
      vars, outputDir
    ));
  }

  // GitHub Actions workflow - choose template based on strategy
  const workflowDir = path.join(outputDir, '.github', 'workflows');
  fs.mkdirSync(workflowDir, { recursive: true });
  const workflowTemplate = config.strategy?.buildLocation === 'ci'
    ? 'github-deploy-ci-build.yml'
    : 'github-deploy.yml';
  generated.push(writeTemplate(
    readTemplate('workflows', workflowTemplate),
    '.github/workflows/deploy.yml',
    vars, outputDir
  ));

  // Nginx config for SPA
  if (['vue-spa', 'react-spa'].includes(config.project.type)) {
    generated.push(writeTemplate(
      readTemplate('nginx', 'default.conf'),
      'nginx.conf',
      vars, outputDir
    ));
  }

  // Server init script
  generated.push(writeTemplate(
    readTemplate('scripts', 'server-init.sh'),
    'server-init.sh',
    vars, outputDir
  ));

  // Ensure .gitattributes enforces LF for .sh files
  const gitattributesPath = path.join(outputDir, '.gitattributes');
  const shRule = '*.sh text eol=lf';
  if (fs.existsSync(gitattributesPath)) {
    const existing = fs.readFileSync(gitattributesPath, 'utf-8');
    if (!/^\*\.sh\s/m.test(existing)) {
      const append = existing.endsWith('\n') ? shRule + '\n' : '\n' + shRule + '\n';
      fs.appendFileSync(gitattributesPath, append, 'utf-8');
      console.log(chalk.green(`  追加: .gitattributes (${shRule})`));
    }
  } else {
    fs.writeFileSync(gitattributesPath, shRule + '\n', 'utf-8');
    console.log(chalk.green(`  生成: .gitattributes`));
  }

  return generated;
}

function buildTemplateVars(config: CollectedConfig, skipDockerFiles: boolean = false): Record<string, string> {
  const startParts = config.project.startCmd.split(/\s+/);
  const dockerCmd = startParts.map(p => `"${p}"`).join(', ');

  // ENV_HARDCODED_LINES: non-sensitive vars written directly into .env
  const envHardcodedLines = Object.entries(config.envVars || {})
    .map(([k, v]) => `            ${k}=${v}`)
    .join('\n');

  // ENV_SECRET_LINES: sensitive vars injected from GitHub Secrets
  const envSecretLines = config.secrets
    .map(key => `            echo "${key}=\${{ secrets.${key} }}" >> .env`)
    .join('\n');

  // ENV_SECRET_PLACEHOLDER_LINES: empty placeholders for secrets in server-init .env
  const envSecretPlaceholderLines = config.secrets
    .map(key => `            ${key}=`)
    .join('\n');

  return {
    APP_NAME: config.project.name,
    APP_PORT: String(config.project.port),
    BUILD_CMD: config.project.buildCmd,
    START_CMD: config.project.startCmd,
    START_CMD_DOCKER: dockerCmd,
    PYTHON_VERSION: '3.11',
    NODE_VERSION: '20',

    DEPLOY_DIR: config.server.deployDir,
    SERVER_HOST: config.server.host,
    SERVER_USER: config.server.user,
    BRANCH_PRODUCTION: config.branches.production,
    DOMAIN_NAME: config.domain.name || 'localhost',
    DOMAIN_ENABLED: String(config.domain.enabled),
    HTTPS_ENABLED: String(config.domain.https),
    DB_ON_HOST: config.database.location === 'host' ? 'true' : '',
    NOT_DB_ON_HOST: config.database.location !== 'host' ? 'true' : '',
    DATA_DIR: config.database.dataDir,
    DB_MIGRATE_CMD: config.database.migrateCmd,
    DB_INIT_CMD: config.database.initCmd,
    SERVER_DIR: config.project.subDirs?.server || 'server',
    CLIENT_DIR: config.project.subDirs?.client || 'client',
    ENV_HARDCODED_LINES: envHardcodedLines,
    ENV_SECRET_LINES: envSecretLines,
    ENV_SECRET_PLACEHOLDER_LINES: envSecretPlaceholderLines,
    DEPLOYMENT_MODE: config.deploymentMode || 'generated',
    PROXY_MODE: config.proxyMode || 'host-nginx',
    SKIP_BUILD: skipDockerFiles ? 'true' : '',

    // Strategy-related vars
    BUILD_ON_CI: config.strategy?.buildLocation === 'ci' ? 'true' : '',
    BUILD_ON_SERVER: config.strategy?.buildLocation !== 'ci' ? 'true' : '',
    TRANSFER_SCP: config.strategy?.transferMethod === 'scp' ? 'true' : '',

    // Mirror vars
    MIRROR_ALPINE: config.strategy?.mirrors?.alpine || '',
    MIRROR_NPM: config.strategy?.mirrors?.npm || '',
    MIRROR_PIP: config.strategy?.mirrors?.pip || '',

    // Docker mirror for daemon.json (pre-formatted as JSON array items)
    MIRROR_DOCKER: (config.strategy?.mirrors?.docker || [])
      .map(m => `"https://${m}"`)
      .join(', '),

    // Native module build tools
    NEEDS_BUILD_TOOLS: config.strategy?.needsBuildTools ? 'true' : '',
  };
}

function getDockerfileTemplate(type: string, projectStructure?: string): string {
  if (projectStructure === 'multi-dir') {
    return readTemplate('dockerfile', 'multi-dir.Dockerfile');
  }
  if (type === 'nextjs') {
    return readTemplate('dockerfile', 'next-standalone.Dockerfile');
  }
  if (['flask', 'django', 'fastapi'].includes(type)) {
    return readTemplate('dockerfile', 'python.Dockerfile');
  }
  if (['vue-spa', 'react-spa'].includes(type)) {
    return readTemplate('dockerfile', 'spa.Dockerfile');
  }
  return readTemplate('dockerfile', 'node.Dockerfile');
}

function writeTemplate(
  template: string,
  relativePath: string,
  vars: Record<string, string>,
  outputDir: string
): GeneratedFile {
  let content = replacePlaceholders(template, vars);
  const fullPath = path.join(outputDir, relativePath);

  // Ensure .sh files always use LF line endings (CRLF breaks bash on Linux)
  if (relativePath.endsWith('.sh')) {
    content = content.replace(/\r\n/g, '\n');
  }
  let backedUp = false;

  // Backup existing file
  if (fs.existsSync(fullPath)) {
    fs.copyFileSync(fullPath, fullPath + '.backup');
    backedUp = true;
    console.log(chalk.yellow(`  备份: ${relativePath} → ${relativePath}.backup`));
  }

  // Ensure directory exists
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, content, 'utf-8');
  console.log(chalk.green(`  生成: ${relativePath}`));

  return { path: relativePath, backedUp };
}
