import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolvePythonExecutable } from './python-runtime'

export { resolvePythonExecutable } from './python-runtime'

export const PROJECT_ROOT = path.resolve(fileURLToPath(new URL('../', import.meta.url)))

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
