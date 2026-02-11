export type ProjectType =
  | 'flask'
  | 'django'
  | 'fastapi'
  | 'nestjs'
  | 'nextjs'
  | 'nuxtjs'
  | 'vue-spa'
  | 'react-spa';

export type Language = 'python' | 'node';

export interface DetectionResult {
  type: ProjectType | null;
  language: Language | null;
  languageVersion: string;
  port: number;
  buildCmd: string;
  startCmd: string;
  entryFile: string;
  envFile: string | null;
  envKeys: string[];
  hasDocker: boolean;
  hasCI: boolean;
}

export interface ServerConfig {
  host: string;
  user: string;
  sshKeyPath: string;
  deployDir: string;
}

export interface DomainConfig {
  enabled: boolean;
  name: string;
  https: boolean;
}

export interface BranchConfig {
  production: string;
  staging: string | null;
}

export interface CollectedConfig {
  project: {
    name: string;
    type: ProjectType;
    language: Language;
    port: number;
    buildCmd: string;
    startCmd: string;
  };
  server: ServerConfig;
  domain: DomainConfig;
  secrets: string[];
  branches: BranchConfig;
  registry: string;
}

export interface GlobalConfig {
  servers: Record<string, ServerConfig>;
  projects: Record<string, { type: ProjectType; lastDeploy?: string }>;
}

export const PROJECT_DEFAULTS: Record<ProjectType, {
  port: number;
  buildCmd: string;
  startCmd: string;
  entryFile: string;
}> = {
  flask: { port: 5000, buildCmd: '', startCmd: 'gunicorn -w 4 -b 0.0.0.0:5000 app:app', entryFile: 'app.py' },
  django: { port: 8000, buildCmd: 'python manage.py collectstatic --noinput', startCmd: 'gunicorn -w 4 -b 0.0.0.0:8000 config.wsgi:application', entryFile: 'manage.py' },
  fastapi: { port: 8000, buildCmd: '', startCmd: 'uvicorn main:app --host 0.0.0.0 --port 8000', entryFile: 'main.py' },
  nestjs: { port: 3000, buildCmd: 'npm run build', startCmd: 'node dist/main', entryFile: 'src/main.ts' },
  nextjs: { port: 3000, buildCmd: 'npm run build', startCmd: 'npm start', entryFile: 'pages/index.tsx' },
  nuxtjs: { port: 3000, buildCmd: 'npm run build', startCmd: 'node .output/server/index.mjs', entryFile: 'nuxt.config.ts' },
  'vue-spa': { port: 80, buildCmd: 'npm run build', startCmd: '', entryFile: 'src/main.ts' },
  'react-spa': { port: 80, buildCmd: 'npm run build', startCmd: '', entryFile: 'src/index.tsx' },
};
