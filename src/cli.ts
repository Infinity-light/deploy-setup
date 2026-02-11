import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import * as path from 'path';
import * as fs from 'fs';
import * as dns from 'dns';
import { Client } from 'ssh2';
import { detectProject } from './core/detector';
import { collectConfig } from './core/collector';
import { generateFiles } from './core/generator';
import { saveProjectRecord } from './utils/config-store';
import { saveCache, loadCache } from './utils/cache';
import { CollectedConfig } from './core/types';

const program = new Command();

program
  .name('deploy-setup')
  .description('通用 CI/CD 配置生成工具 - git push 即部署到 Linux VPS')
  .version('1.0.0');

// ─── init ───
program
  .command('init')
  .description('初始化 CI/CD 配置（交互式）')
  .option('-d, --dir <dir>', '项目目录', process.cwd())
  .option('-c, --config <file>', '使用 JSON 配置文件（跳过交互）')
  .action(async (options) => {
    const projectDir = path.resolve(options.dir);
    const projectName = path.basename(projectDir).toLowerCase().replace(/[^a-z0-9-]/g, '-');

    console.log(chalk.cyan.bold('\n🚀 deploy-setup - CI/CD 配置生成器\n'));

    const spinner = ora('检测项目类型...').start();
    const detection = detectProject(projectDir);
    spinner.succeed(
      detection.type
        ? `检测到: ${detection.type} (${detection.language})`
        : '未能自动检测项目类型'
    );

    if (detection.hasDocker) console.log(chalk.yellow('  ⚠ 已存在 Dockerfile，将备份后覆盖'));
    if (detection.hasCI) console.log(chalk.yellow('  ⚠ 已存在 GitHub Actions 配置，将备份后覆盖'));

    let config: CollectedConfig;
    if (options.config) {
      config = JSON.parse(fs.readFileSync(path.resolve(options.config), 'utf-8'));
      console.log(chalk.green(`  使用配置文件: ${path.resolve(options.config)}`));
    } else {
      config = await collectConfig(detection, projectName);
    }

    console.log(chalk.cyan('\n📦 生成配置文件...\n'));
    const files = generateFiles(config, projectDir);

    saveProjectRecord(config.project.name, config.project.type);
    saveCache(projectDir, config);

    printNextSteps(config, files);
  });

// ─── check-dns ───
program
  .command('check-dns')
  .description('检查域名 DNS 解析是否正确')
  .option('-d, --dir <dir>', '项目目录', process.cwd())
  .action(async (options) => {
    const config = loadCache(path.resolve(options.dir));

    if (!config.domain.enabled) {
      console.log(chalk.yellow('未配置域名，无需检查'));
      return;
    }

    const domain = config.domain.name;
    const expectedIp = config.server.host;

    console.log(chalk.cyan(`\n🔍 检查 DNS: ${domain} → ${expectedIp}\n`));

    try {
      const addresses = await new Promise<string[]>((resolve, reject) => {
        dns.resolve4(domain, (err, addrs) => err ? reject(err) : resolve(addrs));
      });

      const match = addresses.includes(expectedIp);
      if (match) {
        console.log(chalk.green(`  ✔ DNS 正确: ${domain} → ${addresses.join(', ')}`));
      } else {
        console.log(chalk.red(`  ✗ DNS 不匹配`));
        console.log(`    当前解析: ${addresses.join(', ')}`);
        console.log(`    期望指向: ${expectedIp}`);
        console.log(chalk.yellow(`\n  请到域名服务商控制台添加 A 记录:`));
        console.log(`    主机记录: ${domain.split('.')[0]}`);
        console.log(`    记录类型: A`);
        console.log(`    记录值:   ${expectedIp}`);
        console.log(chalk.gray(`    TTL 生效通常需要几分钟到几小时`));
      }
    } catch (err: any) {
      if (err.code === 'ENOTFOUND') {
        console.log(chalk.red(`  ✗ 域名未解析: ${domain}`));
        console.log(chalk.yellow(`\n  请到域名服务商控制台添加 A 记录:`));
        console.log(`    主机记录: ${domain.split('.')[0]}`);
        console.log(`    记录类型: A`);
        console.log(`    记录值:   ${expectedIp}`);
      } else {
        console.log(chalk.red(`  ✗ DNS 查询失败: ${err.message}`));
      }
    }
  });

// ─── setup-server ───
program
  .command('setup-server')
  .description('SSH 到服务器执行初始化脚本')
  .option('-d, --dir <dir>', '项目目录', process.cwd())
  .action(async (options) => {
    const projectDir = path.resolve(options.dir);
    const config = loadCache(projectDir);
    const scriptPath = path.join(projectDir, 'server-init.sh');

    if (!fs.existsSync(scriptPath)) {
      console.log(chalk.red('server-init.sh 不存在，请先运行 deploy-setup init'));
      process.exit(1);
    }

    const scriptContent = fs.readFileSync(scriptPath, 'utf-8');
    const { host, user, sshKeyPath } = config.server;

    console.log(chalk.cyan(`\n🖥  连接服务器: ${user}@${host}\n`));

    // Try key-based auth first, fall back to password
    const os = require('os');
    const resolvedKeyPath = (sshKeyPath || '~/.ssh/id_rsa').replace(/^~/, os.homedir());

    if (fs.existsSync(resolvedKeyPath)) {
      console.log(chalk.gray(`  使用密钥: ${resolvedKeyPath}`));
      const privateKey = fs.readFileSync(resolvedKeyPath, 'utf-8');
      await sshExec(host, user, { privateKey }, scriptContent);
    } else {
      console.log(chalk.gray('  未找到密钥，使用密码认证'));
      const inquirer = require('inquirer');
      const { password } = await inquirer.prompt([{
        type: 'password',
        name: 'password',
        message: `${user}@${host} 密码:`,
        mask: '*',
      }]);
      await sshExec(host, user, { password }, scriptContent);
    }
  });

// ─── setup-secrets ───
program
  .command('setup-secrets')
  .description('使用 gh CLI 配置 GitHub Secrets')
  .option('-d, --dir <dir>', '项目目录', process.cwd())
  .option('-k, --key <path>', 'SSH 私钥文件路径')
  .action(async (options) => {
    const projectDir = path.resolve(options.dir);
    const config = loadCache(projectDir);
    const { execSync } = require('child_process');

    // Check gh CLI
    try {
      execSync('gh --version', { stdio: 'ignore' });
    } catch {
      console.log(chalk.yellow('未检测到 gh CLI，正在自动安装...'));
      try {
        await installGhCli();
        execSync('gh --version', { stdio: 'ignore' });
        console.log(chalk.green('  ✔ gh CLI 安装成功'));
      } catch (err: any) {
        console.log(chalk.red(`  ✗ gh CLI 自动安装失败: ${err.message}`));
        console.log(chalk.red('  请手动安装: https://cli.github.com'));
        process.exit(1);
      }
    }

    // Check gh auth
    try {
      execSync('gh auth status', { stdio: 'ignore', cwd: projectDir });
    } catch {
      console.log(chalk.yellow('gh 未登录，正在启动登录流程...'));
      try {
        execSync('gh auth login', { stdio: 'inherit', cwd: projectDir });
      } catch {
        console.log(chalk.red('gh 登录失败，请手动运行: gh auth login'));
        process.exit(1);
      }
    }

    console.log(chalk.cyan('\n🔑 配置 GitHub Secrets\n'));

    const secrets: Record<string, string> = {
      SERVER_HOST: config.server.host,
      SERVER_USER: config.server.user,
    };

    // Resolve SSH private key path
    let keyPath = options.key || config.server.sshKeyPath;
    if (!keyPath) {
      const inquirer = require('inquirer');
      const answer = await inquirer.prompt([{
        type: 'input',
        name: 'keyPath',
        message: 'SSH 私钥文件路径:',
        default: '~/.ssh/id_rsa',
      }]);
      keyPath = answer.keyPath;
    }

    const resolvedKey = keyPath.replace(/^~/, require('os').homedir());
    if (fs.existsSync(resolvedKey)) {
      secrets['SSH_PRIVATE_KEY'] = fs.readFileSync(resolvedKey, 'utf-8');
    } else {
      console.log(chalk.yellow(`  ⚠ 私钥文件不存在: ${resolvedKey}，跳过 SSH_PRIVATE_KEY`));
    }

    // Set each secret
    for (const [name, value] of Object.entries(secrets)) {
      try {
        execSync(`gh secret set ${name}`, {
          input: value,
          cwd: projectDir,
          stdio: ['pipe', 'ignore', 'pipe'],
        });
        console.log(chalk.green(`  ✔ ${name}`));
      } catch (err: any) {
        console.log(chalk.red(`  ✗ ${name}: ${err.message}`));
      }
    }

    console.log(chalk.green('\n✅ Secrets 配置完成'));
  });

// ─── parse ───
program.parse(process.argv);

// ─── helpers ───

async function installGhCli(): Promise<void> {
  const { execSync } = require('child_process');
  const os = require('os');
  const platform = os.platform();

  if (platform === 'win32') {
    // Windows: download via winget or direct MSI
    try {
      execSync('winget install --id GitHub.cli -e --accept-source-agreements --accept-package-agreements', { stdio: 'inherit' });
      return;
    } catch {
      // winget not available, try scoop
    }
    try {
      execSync('scoop install gh', { stdio: 'inherit' });
      return;
    } catch {
      throw new Error('Windows 上需要 winget 或 scoop 来自动安装 gh CLI');
    }
  } else {
    // Linux/macOS: use official install script
    try {
      execSync('(type -p wget >/dev/null || (apt-get update && apt-get install wget -y)) && mkdir -p -m 755 /etc/apt/keyrings && wget -qO- https://cli.github.com/packages/githubcli-archive-keyring.gpg | tee /etc/apt/keyrings/githubcli-archive-keyring.gpg > /dev/null && chmod go+r /etc/apt/keyrings/githubcli-archive-keyring.gpg && echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" | tee /etc/apt/sources.list.d/github-cli.list > /dev/null && apt-get update && apt-get install gh -y', { stdio: 'inherit' });
      return;
    } catch {
      // apt not available, try brew
    }
    try {
      execSync('brew install gh', { stdio: 'inherit' });
      return;
    } catch {
      throw new Error('自动安装失败，请手动安装: https://cli.github.com');
    }
  }
}

function sshExec(host: string, user: string, auth: { password?: string; privateKey?: string }, script: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const conn = new Client();

    conn.on('ready', () => {
      console.log(chalk.green('  ✔ SSH 连接成功\n'));

      conn.exec(`bash -s`, (err, stream) => {
        if (err) { conn.end(); return reject(err); }

        stream.on('close', (code: number) => {
          conn.end();
          if (code === 0) {
            console.log(chalk.green('\n  ✔ 服务器初始化完成'));
            resolve();
          } else {
            reject(new Error(`脚本退出码: ${code}`));
          }
        });

        stream.on('data', (data: Buffer) => process.stdout.write(data));
        stream.stderr.on('data', (data: Buffer) => process.stderr.write(data));

        stream.end(script.replace(/\r\n/g, '\n'));
      });
    });

    conn.on('error', (err) => {
      console.log(chalk.red(`  ✗ SSH 连接失败: ${err.message}`));
      reject(err);
    });

    conn.connect({
      host, port: 22, username: user,
      ...(auth.privateKey ? { privateKey: auth.privateKey } : { password: auth.password }),
    });
  });
}

function printNextSteps(config: CollectedConfig, files: { path: string; backedUp: boolean }[]) {
  console.log(chalk.green.bold('\n✅ 配置文件生成完成!\n'));

  console.log(chalk.cyan('生成的文件:'));
  files.forEach(f => {
    const badge = f.backedUp ? chalk.yellow(' (已备份原文件)') : '';
    console.log(`  ${f.path}${badge}`);
  });

  console.log(chalk.cyan('\n📋 后续步骤:\n'));

  // Step 1: DNS
  if (config.domain.enabled) {
    console.log(chalk.white('1. 检查域名 DNS 解析:'));
    console.log(`   deploy-setup check-dns`);
  } else {
    console.log(chalk.white('1. 域名: 未配置，跳过'));
  }

  // Step 2: Server init
  console.log(chalk.white('\n2. 初始化服务器 (安装 Docker、配置 Nginx 等):'));
  console.log(`   deploy-setup setup-server`);

  // Step 3: GitHub Secrets
  console.log(chalk.white('\n3. 配置 GitHub Secrets:'));
  console.log(`   deploy-setup setup-secrets`);
  console.log(chalk.gray(`   需要的 Secrets: SERVER_HOST, SERVER_USER, SSH_PRIVATE_KEY`));
  if (config.secrets.length > 0) {
    console.log(chalk.gray(`   环境变量 Secrets: ${config.secrets.join(', ')}`));
  }

  // Step 4: Push
  console.log(chalk.white('\n4. 推送代码触发部署:'));
  console.log(`   git add . && git commit -m "add CI/CD config"`);
  console.log(`   git push origin ${config.branches.production}`);

  console.log('');
}
