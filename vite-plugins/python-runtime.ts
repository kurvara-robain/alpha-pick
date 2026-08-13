import fs from 'node:fs'

/** Resolve the Python executable without depending on a working directory. */
export function resolvePythonExecutable(options: {
  platform?: NodeJS.Platform
  configured?: string
  exists?: (candidate: string) => boolean
} = {}): string {
  const platform = options.platform ?? process.platform
  const configured = (options.configured ?? process.env.ALPHAMIND_PYTHON)?.trim()
  const exists = options.exists ?? fs.existsSync
  if (configured) return configured

  if (platform === 'win32') {
    return [
      String.raw`C:\ProgramData\miniconda3\envs\qlib\python.exe`,
      String.raw`C:\ProgramData\Miniconda3\envs\qlib\python.exe`,
    ].find(exists) ?? 'python'
  }

  const unixCandidates = platform === 'darwin'
    ? ['/opt/homebrew/bin/python3', '/usr/local/bin/python3', '/usr/bin/python3']
    : ['/usr/bin/python3']
  return unixCandidates.find(exists) ?? 'python3'
}
