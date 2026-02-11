import inquirer from 'inquirer';
import chalk from 'chalk';
import { DetectionResult, ProjectType, CollectedConfig, Language, ServerConfig, PROJECT_DEFAULTS } from './types';
import { getSavedServers, saveServer } from '../utils/config-store';

const PROJECT_TYPE_LABELS: Record<ProjectType, string> = {
  flask: 'Flask',
  django: 'Django',
  fastapi: 'FastAPI',
  nestjs: 'NestJS',
  nextjs: 'Next.js',
  nuxtjs: 'Nuxt.js',
  'vue-spa': 'Vue SPA',
  'react-spa': 'React SPA',
};

export async function collectConfig(detection: DetectionResult, projectName: string): Promise<CollectedConfig> {
  console.log(chalk.cyan('\n📋 开始收集部署配置...\n'));

  const project = await collectProjectConfig(detection, projectName);
  const server = await collectServerConfig();
  const domain = await collectDomainConfig();
  const secrets = await collectSecrets(detection.envKeys);
  const branches = await collectBranchConfig();

  const config: CollectedConfig = {
    project,
    server,
    domain,
    secrets,
    branches,
    registry: 'ghcr.io',
  };

  return await reviewLoop(config, detection);
}

async function collectProjectConfig(detection: DetectionResult, projectName: string) {
  const typeChoices = Object.entries(PROJECT_TYPE_LABELS).map(([value, name]) => ({ name, value }));

  const answers = await inquirer.prompt([
    {
      type: 'input',
      name: 'name',
      message: '项目名称:',
      default: projectName,
      validate: (v: string) => /^[a-z0-9-]+$/.test(v) || '只允许小写字母、数字和连字符',
    },
    {
      type: 'list',
      name: 'type',
      message: '项目类型:',
      choices: typeChoices,
      default: detection.type,
    },
    {
      type: 'number',
      name: 'port',
      message: '应用端口:',
      default: detection.port,
    },
    {
      type: 'input',
      name: 'buildCmd',
      message: '构建命令 (留空则无):',
      default: detection.buildCmd,
    },
    {
      type: 'input',
      name: 'startCmd',
      message: '启动命令:',
      default: detection.startCmd,
    },
  ]);

  const type = answers.type as ProjectType;
  const language: Language = ['flask', 'django', 'fastapi'].includes(type) ? 'python' : 'node';

  return { ...answers, language };
}

async function collectServerConfig(): Promise<ServerConfig> {
  const saved = getSavedServers();
  const serverNames = Object.keys(saved);

  let server: ServerConfig;

  if (serverNames.length > 0) {
    const { choice } = await inquirer.prompt([{
      type: 'list',
      name: 'choice',
      message: '选择服务器:',
      choices: [
        ...serverNames.map(name => ({
          name: `${name} (${saved[name].host})`,
          value: name,
        })),
        { name: '+ 添加新服务器', value: '__new__' },
      ],
    }]);

    if (choice !== '__new__') {
      server = saved[choice];
      // Allow overriding deployDir
      const { deployDir } = await inquirer.prompt([{
        type: 'input',
        name: 'deployDir',
        message: '部署目录:',
        default: server.deployDir,
      }]);
      server.deployDir = deployDir;
      return server;
    }
  }

  const answers = await inquirer.prompt([
    {
      type: 'input',
      name: 'host',
      message: '服务器 IP/域名:',
      validate: (v: string) => v.trim().length > 0 || '不能为空',
    },
    {
      type: 'input',
      name: 'user',
      message: 'SSH 用户名:',
      default: 'root',
    },
    {
      type: 'input',
      name: 'sshKeyPath',
      message: 'SSH 私钥路径:',
      default: '~/.ssh/id_rsa',
    },
    {
      type: 'input',
      name: 'deployDir',
      message: '部署目录:',
      default: '/opt/apps',
    },
  ]);

  // Save for future use
  const { saveName } = await inquirer.prompt([{
    type: 'input',
    name: 'saveName',
    message: '为此服务器取个名字 (方便下次选择):',
    default: answers.host,
  }]);
  saveServer(saveName, answers);

  return answers;
}

async function collectDomainConfig() {
  const { enabled } = await inquirer.prompt([{
    type: 'confirm',
    name: 'enabled',
    message: '是否配置域名?',
    default: false,
  }]);

  if (!enabled) {
    return { enabled: false, name: '', https: false };
  }

  const answers = await inquirer.prompt([
    {
      type: 'input',
      name: 'name',
      message: '域名:',
      validate: (v: string) => v.trim().length > 0 || '不能为空',
    },
    {
      type: 'confirm',
      name: 'https',
      message: '启用 HTTPS (Let\'s Encrypt)?',
      default: true,
    },
  ]);

  return { enabled, ...answers };
}

async function collectSecrets(envKeys: string[]): Promise<string[]> {
  if (envKeys.length === 0) {
    console.log(chalk.yellow('  未检测到 .env 文件，跳过环境变量配置'));
    return [];
  }

  console.log(chalk.cyan('\n  检测到以下环境变量:'));
  envKeys.forEach(k => console.log(`    ${k}`));

  const { secrets } = await inquirer.prompt([{
    type: 'checkbox',
    name: 'secrets',
    message: '选择需要作为 GitHub Secrets 的敏感变量:',
    choices: envKeys.map(k => ({
      name: k,
      value: k,
      checked: /secret|password|key|token|api/i.test(k),
    })),
  }]);

  return secrets;
}

async function collectBranchConfig() {
  const { production } = await inquirer.prompt([{
    type: 'input',
    name: 'production',
    message: '生产部署分支:',
    default: 'main',
  }]);

  const { hasStaging } = await inquirer.prompt([{
    type: 'confirm',
    name: 'hasStaging',
    message: '是否配置预发布分支?',
    default: false,
  }]);

  let staging: string | null = null;
  if (hasStaging) {
    const ans = await inquirer.prompt([{
      type: 'input',
      name: 'staging',
      message: '预发布分支名:',
      default: 'develop',
    }]);
    staging = ans.staging;
  }

  return { production, staging };
}

async function reviewLoop(config: CollectedConfig, detection: DetectionResult): Promise<CollectedConfig> {
  while (true) {
    console.log(chalk.cyan('\n━━━ 配置摘要 ━━━'));
    console.log(`  项目: ${config.project.name} (${config.project.type})`);
    console.log(`  端口: ${config.project.port}`);
    console.log(`  服务器: ${config.server.user}@${config.server.host}`);
    console.log(`  部署目录: ${config.server.deployDir}/${config.project.name}`);
    if (config.domain.enabled) {
      console.log(`  域名: ${config.domain.name} (HTTPS: ${config.domain.https ? '是' : '否'})`);
    }
    console.log(`  分支: ${config.branches.production}${config.branches.staging ? ` / ${config.branches.staging}` : ''}`);
    if (config.secrets.length > 0) {
      console.log(`  Secrets: ${config.secrets.join(', ')}`);
    }
    console.log(chalk.cyan('━━━━━━━━━━━━━━━━\n'));

    const { action } = await inquirer.prompt([{
      type: 'list',
      name: 'action',
      message: '确认配置?',
      choices: [
        { name: '✓ 确认，开始生成', value: 'confirm' },
        { name: '✎ 修改项目配置', value: 'project' },
        { name: '✎ 修改服务器配置', value: 'server' },
        { name: '✎ 修改域名配置', value: 'domain' },
        { name: '✗ 取消', value: 'cancel' },
      ],
    }]);

    if (action === 'confirm') return config;
    if (action === 'cancel') {
      console.log(chalk.yellow('已取消'));
      process.exit(0);
    }

    if (action === 'project') {
      const p = await collectProjectConfig(detection, config.project.name);
      config.project = p;
    } else if (action === 'server') {
      config.server = await collectServerConfig();
    } else if (action === 'domain') {
      config.domain = await collectDomainConfig();
    }
  }
}
