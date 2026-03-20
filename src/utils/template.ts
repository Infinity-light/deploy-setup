import * as fs from 'fs';
import * as path from 'path';

export function replacePlaceholders(template: string, vars: Record<string, string>): string {
  let result = template;

  // Step 1: Process {{#IF VAR}}...{{/IF}} conditional blocks
  const ifBlockPattern = /\{\{#IF\s+(\w+)\}\}([\s\S]*?)\{\{\/IF\}\}/g;
  result = result.replace(ifBlockPattern, (_match, varName: string, content: string) => {
    const value = vars[varName];
    if (value !== undefined && value !== '') {
      return content;
    }
    return '';
  });

  // Step 2: Replace plain {{VAR}} placeholders
  for (const [key, value] of Object.entries(vars)) {
    const placeholder = new RegExp('\\{\\{' + key + '\\}\\}', 'g');
    result = result.replace(placeholder, value);
  }

  return result;
}

export function readTemplate(category: string, name: string): string {
  const templateDir = path.join(__dirname, '..', 'templates');
  const filePath = path.join(templateDir, category, name);
  if (!fs.existsSync(filePath)) {
    throw new Error(`模板文件不存在: ${filePath}`);
  }
  return fs.readFileSync(filePath, 'utf-8');
}
