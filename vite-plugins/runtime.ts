import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const PROJECT_ROOT = path.resolve(fileURLToPath(new URL('../', import.meta.url)))

function firstExisting(paths: string[]): string | undefined {
  return paths.find((candidate) => path.isAbsolute(candidate) && fs.existsSync(candidate))
}

/**
 * Python used by the Vite API plugins.
 *
 * ALPHAMIND_PYTHON is the portable override for deployments and services.
 * The Windows default matches the project's documented Conda environment;
 * Unix keeps the original /usr/bin/python3 preference and then falls back to PATH.
 */
export function resolvePythonExecutable(): string {
  const configured = process.env.ALPHAMIND_PYTHON?.trim()
  if (configured) return configured

  if (process.platform === 'win32') {
    return firstExisting([
      String.raw`C:\ProgramData\miniconda3\envs\qlib\python.exe`,
      String.raw`C:\ProgramData\Miniconda3\envs\qlib\python.exe`,
    ]) ?? 'python'
  }

  return firstExisting(['/usr/bin/python3', '/opt/homebrew/bin/python3']) ?? 'python3'
}

export const PYTHON_EXECUTABLE = resolvePythonExecutable()

export const PYTHON_ENV: NodeJS.ProcessEnv = {
  ...process.env,
  PYTHONUNBUFFERED: '1',
  // Python otherwise defaults to the active Windows code page (often GBK),
  // while all project source/data files and Node pipes use UTF-8.
  PYTHONUTF8: '1',
  PYTHONIOENCODING: 'utf-8',
}

export function projectPath(...parts: string[]): string {
  return path.join(PROJECT_ROOT, ...parts)
}
