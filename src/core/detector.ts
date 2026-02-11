import * as fs from 'fs';
import * as path from 'path';
import { DetectionResult, ProjectType, Language, PROJECT_DEFAULTS } from './types';

export function detectProject(rootDir: string): DetectionResult {
  const files = fs.readdirSync(rootDir);
  const result: DetectionResult = {
    type: null,
    language: null,
    languageVersion: '',
    port: 3000,
    buildCmd: '',
    startCmd: '',
    entryFile: '',
    envFile: null,
    envKeys: [],
    hasDocker: files.includes('Dockerfile'),
    hasCI: fs.existsSync(path.join(rootDir, '.github', 'workflows')),
  };

  // Detect .env
  const envFile = files.find(f => f === '.env' || f === '.env.example' || f === '.env.production');
  if (envFile) {
    result.envFile = envFile;
    result.envKeys = parseEnvKeys(path.join(rootDir, envFile));
  }

  // Python project detection
  if (files.includes('requirements.txt') || files.includes('pyproject.toml') || files.includes('Pipfile')) {
    result.language = 'python';
    result.languageVersion = '3.11';
    result.type = detectPythonFramework(rootDir, files);
  }
  // Node project detection
  else if (files.includes('package.json')) {
    result.language = 'node';
    result.languageVersion = '20';
    result.type = detectNodeFramework(rootDir);
  }

  // Apply defaults if type detected
  if (result.type) {
    const defaults = PROJECT_DEFAULTS[result.type];
    result.port = defaults.port;
    result.buildCmd = defaults.buildCmd;
    result.startCmd = defaults.startCmd;
    result.entryFile = defaults.entryFile;

    // Flask: detect factory pattern (run.py with create_app)
    if (result.type === 'flask') {
      const runPy = path.join(rootDir, 'run.py');
      if (fs.existsSync(runPy)) {
        const content = fs.readFileSync(runPy, 'utf-8');
        if (content.includes('create_app')) {
          result.startCmd = result.startCmd.replace('app:app', 'run:app');
          result.entryFile = 'run.py';
        }
      }
    }
  }

  // Try to detect port from source
  const detectedPort = detectPort(rootDir, result.language);
  if (detectedPort) result.port = detectedPort;

  return result;
}

function detectPythonFramework(rootDir: string, files: string[]): ProjectType | null {
  // Read requirements.txt or pyproject.toml to find framework
  let deps = '';
  if (files.includes('requirements.txt')) {
    deps = fs.readFileSync(path.join(rootDir, 'requirements.txt'), 'utf-8').toLowerCase();
  } else if (files.includes('pyproject.toml')) {
    deps = fs.readFileSync(path.join(rootDir, 'pyproject.toml'), 'utf-8').toLowerCase();
  }

  if (deps.includes('fastapi')) return 'fastapi';
  if (deps.includes('django')) return 'django';
  if (deps.includes('flask')) return 'flask';

  // Fallback: check for manage.py (Django) or app.py (Flask)
  if (files.includes('manage.py')) return 'django';
  if (files.includes('app.py')) return 'flask';
  if (files.includes('main.py')) return 'fastapi';

  return null;
}

function detectNodeFramework(rootDir: string): ProjectType | null {
  const pkgPath = path.join(rootDir, 'package.json');
  if (!fs.existsSync(pkgPath)) return null;

  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
  const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };

  if (allDeps['@nestjs/core']) return 'nestjs';
  if (allDeps['next']) return 'nextjs';
  if (allDeps['nuxt'] || allDeps['nuxt3']) return 'nuxtjs';
  if (allDeps['vue'] && !allDeps['nuxt']) return 'vue-spa';
  if (allDeps['react'] && !allDeps['next']) return 'react-spa';

  return null;
}

function detectPort(rootDir: string, language: Language | null): number | null {
  const portPatterns = [
    /port\s*[=:]\s*(\d{4,5})/i,
    /listen\s*\(\s*(\d{4,5})/i,
    /PORT\s*[=:]\s*["']?(\d{4,5})/,
  ];

  const candidates: string[] = [];
  if (language === 'python') {
    candidates.push('app.py', 'main.py', 'manage.py', 'config.py', 'settings.py');
  } else if (language === 'node') {
    candidates.push('src/main.ts', 'src/index.ts', 'server.js', 'index.js', 'app.js');
  }

  for (const file of candidates) {
    const filePath = path.join(rootDir, file);
    if (!fs.existsSync(filePath)) continue;
    const content = fs.readFileSync(filePath, 'utf-8');
    for (const pattern of portPatterns) {
      const match = content.match(pattern);
      if (match) return parseInt(match[1], 10);
    }
  }
  return null;
}

function parseEnvKeys(envPath: string): string[] {
  const content = fs.readFileSync(envPath, 'utf-8');
  return content
    .split('\n')
    .filter(line => line.trim() && !line.startsWith('#') && line.includes('='))
    .map(line => line.split('=')[0].trim());
}
