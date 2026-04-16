import { EXIT_SUCCESS } from '../core/types';

export interface JsonResult {
  status: 'success' | 'error';
  exitCode: number;
  [key: string]: unknown;
}

/**
 * Write structured JSON to stdout and exit.
 * All other output (spinners, chalk, logs) should go to stderr when in JSON mode.
 */
export function emitJson(result: JsonResult): never {
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  process.exit(result.exitCode);
}

/**
 * Write a success JSON result to stdout and exit.
 */
export function emitJsonSuccess(data: Record<string, unknown>): never {
  emitJson({ status: 'success', exitCode: EXIT_SUCCESS, ...data });
}

/**
 * Write an error JSON result to stdout and exit.
 */
export function emitJsonError(exitCode: number, message: string, details?: Record<string, unknown>): never {
  emitJson({ status: 'error', exitCode, message, ...details });
}

/**
 * When --json mode is active, redirect console.log to stderr
 * so that stdout remains pure JSON.
 */
export function redirectConsoleToStderr(): void {
  const stderrWrite = (...args: unknown[]) => {
    process.stderr.write(args.map(String).join(' ') + '\n');
  };
  console.log = stderrWrite;
  console.info = stderrWrite;
  console.warn = stderrWrite;
}
