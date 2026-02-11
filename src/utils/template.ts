import * as fs from 'fs';
import * as path from 'path';

export function replacePlaceholders(template: string, vars: Record<string, string>): string {
  let result = template;
  for (const [key, value] of Object.entries(vars)) {
    const placeholder = new RegExp(`\\{\\{${key}\\}\\}`, 'g');
    result = result.replace(placeholder, value);
  }
  return result;
}

export function readTemplate(category: string, name: string): string {
  // Templates live in src/templates, resolve from project root
  const projectRoot = path.join(__dirname, '..', '..');
  const templateDir = path.join(projectRoot, 'src', 'templates', category);
  const filePath = path.join(templateDir, name);
  if (!fs.existsSync(filePath)) {
    throw new Error(`模板文件不存在: ${filePath}`);
  }
  return fs.readFileSync(filePath, 'utf-8');
}
