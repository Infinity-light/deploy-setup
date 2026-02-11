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

// ─── all (一键部署) ───
program
  .command('all')
  .description('一键完成全部配置并部署（init → DNS → 服务器 → Secrets → push）')
  .option('-d, --dir <dir>', '项目目录', process.cwd())
  .option('-c, --config <file>', '使用 JSON 配置文件（跳过交互）')
  .option('-k, --key <path>', 'SSH 私钥文件路径')
  .action(async (options) => {
    const projectDir = path.resolve(options.dir);

    console.log(chalk.cyan.bold('\n🚀 deploy-setup - 一键部署\n'));

    // Step 1: init
    const config = await runInit(projectDir, options.config);

    // Step 2: check-dns (non-blocking)
    await runCheckDns(projectDir);

    // Step 3: setup-server
    await runSetupServer(projectDir);

    // Step 4: setup-secrets
    await runSetupSecrets(projectDir, options.key);

    // Step 5: git push
    await runPushAndVerify(projectDir, config.branches.production);

    console.log(chalk.green.bold('\n✅ 部署完成! 后续 git push 即自动部署。\n'));
  });

// ─── init ───
program
  .command('init')
  .description('初始化 CI/CD 配置（交互式）')
  .option('-d, --dir <dir>', '项目目录', process.cwd())
  .option('-c, --config <file>', '使用 JSON 配置文件（跳过交互）')
  .action(async (options) => {
    const projectDir = path.resolve(options.dir);
    console.log(chalk.cyan.bold('\n🚀 deploy-setup - CI/CD 配置生成器\n'));
    const config = await runInit(projectDir, options.config);
    printNextSteps(config);
  });

// ─── check-dns ───
program
  .command('check-dns')
  .description('检查域名 DNS 解析是否正确')
  .option('-d, --dir <dir>', '项目目录', process.cwd())
  .action(async (options) => {
    await runCheckDns(path.resolve(options.dir));
  });

// ─── setup-server ───
program
  .command('setup-server')
  .description('SSH 到服务器执行初始化脚本')
  .option('-d, --dir <dir>', '项目目录', process.cwd())
  .action(async (options) => {
    await runSetupServer(path.resolve(options.dir));
  });

// ─── setup-secrets ───
program
  .command('setup-secrets')
  .description('使用 gh CLI 配置 GitHub Secrets')
  .option('-d, --dir <dir>', '项目目录', process.cwd())
  .option('-k, --key <path>', 'SSH 私钥文件路径')
  .action(async (options) => {
    await runSetupSecrets(path.resolve(options.dir), options.key);
  });

// ─── parse ───
program.parse(process.argv);

// ─── core functions ───

async function runInit(projectDir: string, configFile?: string): Promise<CollectedConfig> {
  const projectName = path.basename(projectDir).toLowerCase().replace(/[^a-z0-9-]/g, '-');

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
  if (configFile) {
    config = JSON.parse(fs.readFileSync(path.resolve(configFile), 'utf-8'));
    console.log(chalk.green(`  使用配置文件: ${path.resolve(configFile)}`));
  } else {
    config = await collectConfig(detection, projectName);
  }

  console.log(chalk.cyan('\n📦 生成配置文件...\n'));
  generateFiles(config, projectDir);

  saveProjectRecord(config.project.name, config.project.type);
  saveCache(projectDir, config);

  return config;
}

async function runCheckDns(projectDir: string): Promise<void> {
  const config = loadCache(projectDir);

  if (!config.domain.enabled) {
    console.log(chalk.yellow('未配置域名，跳过 DNS 检查'));
    return;
  }

  const domain = config.domain.name;
  const expectedIp = config.server.host;

  console.log(chalk.cyan(`\n🔍 检查 DNS: ${domain} → ${expectedIp}\n`));

  try {
    const addresses = await new Promise<string[]>((resolve, reject) => {
      dns.resolve4(domain, (err, addrs) => err ? reject(err) : resolve(addrs));
    });

    if (addresses.includes(expectedIp)) {
      console.log(chalk.green(`  ✔ DNS 正确: ${domain} → ${addresses.join(', ')}`));
    } else {
      console.log(chalk.yellow(`  ⚠ DNS 不匹配 (当前: ${addresses.join(', ')}，期望: ${expectedIp})`));
      console.log(chalk.yellow('  部署将继续，但域名访问可能不可用'));
    }
  } catch (err: any) {
    console.log(chalk.yellow(`  ⚠ DNS 查询失败: ${err.message}，跳过`));
  }
}

async function runSetupServer(projectDir: string): Promise<void> {
  const config = loadCache(projectDir);
  const scriptPath = path.join(projectDir, 'server-init.sh');

  if (!fs.existsSync(scriptPath)) {
    throw new Error('server-init.sh 不存在，请先运行 deploy-setup init');
  }

  const scriptContent = fs.readFileSync(scriptPath, 'utf-8');
  const { host, user, sshKeyPath } = config.server;

  console.log(chalk.cyan(`\n🖥  连接服务器: ${user}@${host}\n`));

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
}

async function runSetupSecrets(projectDir: string, keyPath?: string): Promise<void> {
  const config = loadCache(projectDir);
  const { execSync } = require('child_process');

  // Check gh CLI
  try {
    execSync('gh --version', { stdio: 'ignore' });
  } catch {
    console.log(chalk.yellow('未检测到 gh CLI，正在自动安装...'));
    try {
      await installGhCli();
      console.log(chalk.green('  ✔ gh CLI 安装成功'));
    } catch (err: any) {
      throw new Error(`gh CLI 自动安装失败: ${err.message}\n  请手动安装: https://cli.github.com`);
    }
  }

  // Check gh auth
  try {
    execSync('gh auth status', { stdio: 'ignore', cwd: projectDir });
  } catch {
    console.log(chalk.yellow('gh 未登录，正在启动登录流程...'));
    execSync('gh auth login', { stdio: 'inherit', cwd: projectDir });
  }

  console.log(chalk.cyan('\n🔑 配置 GitHub Secrets\n'));

  const secrets: Record<string, string> = {
    SERVER_HOST: config.server.host,
    SERVER_USER: config.server.user,
  };

  // Resolve SSH private key
  let resolvedKeyPath = keyPath || config.server.sshKeyPath;
  if (!resolvedKeyPath) {
    const inquirer = require('inquirer');
    const answer = await inquirer.prompt([{
      type: 'input', name: 'keyPath',
      message: 'SSH 私钥文件路径:', default: '~/.ssh/id_rsa',
    }]);
    resolvedKeyPath = answer.keyPath;
  }

  const fullKeyPath = resolvedKeyPath.replace(/^~/, require('os').homedir());
  if (fs.existsSync(fullKeyPath)) {
    secrets['SSH_PRIVATE_KEY'] = fs.readFileSync(fullKeyPath, 'utf-8');
  } else {
    console.log(chalk.yellow(`  ⚠ 私钥文件不存在: ${fullKeyPath}，跳过 SSH_PRIVATE_KEY`));
  }

  for (const [name, value] of Object.entries(secrets)) {
    try {
      execSync(`gh secret set ${name}`, {
        input: value, cwd: projectDir,
        stdio: ['pipe', 'ignore', 'pipe'],
      });
      console.log(chalk.green(`  ✔ ${name}`));
    } catch (err: any) {
      console.log(chalk.red(`  ✗ ${name}: ${err.message}`));
    }
  }

  console.log(chalk.green('\n✅ Secrets 配置完成'));
}

async function runPushAndVerify(projectDir: string, branch: string): Promise<void> {
  const { execSync } = require('child_process');

  console.log(chalk.cyan(`\n📤 推送到 GitHub (${branch})\n`));

  try {
    execSync('git add .', { cwd: projectDir, stdio: 'pipe' });
    execSync('git commit -m "add CI/CD config (deploy-setup)"', { cwd: projectDir, stdio: 'pipe' });
    console.log(chalk.green('  ✔ 已提交'));
  } catch {
    console.log(chalk.yellow('  无新变更需要提交，继续推送'));
  }

  execSync(`git push origin ${branch}`, { cwd: projectDir, stdio: 'inherit' });
  console.log(chalk.green('  ✔ 已推送'));

  // Wait for Actions run
  console.log(chalk.cyan('\n⏳ 等待 GitHub Actions 运行...\n'));
  await new Promise(r => setTimeout(r, 5000));

  for (let i = 0; i < 30; i++) {
    try {
      const result = execSync('gh run list --limit 1 --json status,conclusion,name', {
        cwd: projectDir, encoding: 'utf-8',
      });
      const runs = JSON.parse(result);
      if (runs.length > 0) {
        const run = runs[0];
        if (run.status === 'completed') {
          if (run.conclusion === 'success') {
            console.log(chalk.green(`  ✔ Actions 运行成功: ${run.name}`));
          } else {
            console.log(chalk.red(`  ✗ Actions 运行失败: ${run.name} (${run.conclusion})`));
            console.log(chalk.yellow('  运行 gh run view --log-failed 查看详情'));
          }
          return;
        }
        console.log(chalk.gray(`  运行中... (${run.status})`));
      }
    } catch {
      // gh not available, skip verification
      console.log(chalk.yellow('  无法查询 Actions 状态，请手动检查'));
      return;
    }
    await new Promise(r => setTimeout(r, 10000));
  }

  console.log(chalk.yellow('  等待超时，请手动检查 Actions 状态'));
}

function sshExec(host: string, user: string, auth: { privateKey?: string; password?: string }, script: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const conn = new Client();
    conn.on('ready', () => {
      console.log(chalk.green('  ✔ SSH 连接成功'));
      conn.exec(script, (err, stream) => {
        if (err) { conn.end(); return reject(err); }
        stream.on('data', (data: Buffer) => process.stdout.write(data));
        stream.stderr.on('data', (data: Buffer) => process.stderr.write(data));
        stream.on('close', (code: number) => {
          conn.end();
          if (code === 0) resolve();
          else reject(new Error(`脚本退出码: ${code}`));
        });
      });
    });
    conn.on('error', reject);
    conn.connect({ host, port: 22, username: user, ...auth });
  });
}

async function installGhCli(): Promise<void> {
  const { execSync } = require('child_process');
  const platform = process.platform;

  if (platform === 'win32') {
    execSync('winget install --id GitHub.cli -e --source winget', { stdio: 'inherit' });
  } else if (platform === 'darwin') {
    execSync('brew install gh', { stdio: 'inherit' });
  } else {
    // Linux
    execSync(
      'type -p curl >/dev/null || (apt-get update && apt-get install curl -y) && '
      + 'curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg | dd of=/usr/share/keyrings/githubcli-archive-keyring.gpg && '
      + 'chmod go+r /usr/share/keyrings/githubcli-archive-keyring.gpg && '
      + 'echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" | tee /etc/apt/sources.list.d/github-cli.list > /dev/null && '
      + 'apt-get update && apt-get install gh -y',
      { stdio: 'inherit' }
    );
  }
}

function printNextSteps(config: CollectedConfig): void {
  console.log(chalk.cyan.bold('\n📋 后续步骤:\n'));
  console.log('  1. 配置 GitHub Secrets:');
  console.log(chalk.gray('     deploy-setup setup-secrets'));
  console.log('  2. 初始化服务器:');
  console.log(chalk.gray('     deploy-setup setup-server'));
  console.log('  3. 推送代码触发部署:');
  console.log(chalk.gray(`     git add . && git commit -m "add CI/CD" && git push origin ${config.branches.production}`));
  console.log('');
  console.log(chalk.gray('  或者一键完成: deploy-setup all'));
}
