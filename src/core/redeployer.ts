import { execSync } from 'node:child_process'
import { readFileSync, existsSync } from 'node:fs'

export interface RedeployOptions {
  configPath: string
  workflow?: string
}

export async function redeployProject(opts: RedeployOptions): Promise<void> {
  if (!existsSync(opts.configPath)) {
    throw new Error(`.deploy/config.json 不存在，请先运行 deploy-setup all（路径：${opts.configPath}）`)
  }

  const cfg = JSON.parse(readFileSync(opts.configPath, 'utf-8'))
  const wf = opts.workflow || cfg.ci?.workflowFile || detectDeployWorkflow()

  execSync(`gh workflow run ${wf}`, { stdio: 'inherit' })
  console.log(`已触发 workflow_dispatch: ${wf}`)
}

function detectDeployWorkflow(): string {
  const candidates = [
    '.github/workflows/deploy.yml',
    '.github/workflows/deploy-ci-build.yml',
  ]
  for (const p of candidates) {
    if (existsSync(p)) return p.split('/').pop()!
  }
  throw new Error(
    '未找到 deploy*.yml workflow，请用 --workflow 显式指定，或先运行 deploy-setup all 生成 CI workflow'
  )
}
