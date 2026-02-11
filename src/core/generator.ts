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
  const vars = buildTemplateVars(config);

  // Dockerfile
  generated.push(writeTemplate(
    getDockerfileTemplate(config.project.type),
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

  // GitHub Actions workflow
  const workflowDir = path.join(outputDir, '.github', 'workflows');
  fs.mkdirSync(workflowDir, { recursive: true });
  generated.push(writeTemplate(
    readTemplate('workflows', 'github-deploy.yml'),
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

  return generated;
}

function buildTemplateVars(config: CollectedConfig): Record<string, string> {
  const startParts = config.project.startCmd.split(/\s+/);
  const dockerCmd = startParts.map(p => `"${p}"`).join(', ');

  return {
    APP_NAME: config.project.name,
    APP_PORT: String(config.project.port),
    BUILD_CMD: config.project.buildCmd,
    START_CMD: config.project.startCmd,
    START_CMD_DOCKER: dockerCmd,
    PYTHON_VERSION: '3.11',
    NODE_VERSION: '20',
    REGISTRY: config.registry,
    GITHUB_USER: '${GITHUB_USER}',
    DEPLOY_DIR: config.server.deployDir,
    SERVER_HOST: config.server.host,
    SERVER_USER: config.server.user,
    BRANCH_PRODUCTION: config.branches.production,
    DOMAIN_NAME: config.domain.name || 'localhost',
    DOMAIN_ENABLED: String(config.domain.enabled),
    HTTPS_ENABLED: String(config.domain.https),
  };
}

function getDockerfileTemplate(type: string): string {
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
  const content = replacePlaceholders(template, vars);
  const fullPath = path.join(outputDir, relativePath);
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
