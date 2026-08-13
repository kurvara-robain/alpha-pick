import { describe, expect, it } from 'vitest'
import { resolvePythonExecutable } from '../../vite-plugins/python-runtime'

describe('cross-platform Python executable resolution', () => {
  it('uses the explicit deployment override on every platform', () => {
    expect(resolvePythonExecutable({
      platform: 'win32',
      configured: String.raw`D:\envs\alpha\python.exe`,
      exists: () => false,
    })).toBe(String.raw`D:\envs\alpha\python.exe`)
  })

  it('uses the documented Conda environment on Windows when present', () => {
    expect(resolvePythonExecutable({
      platform: 'win32',
      exists: (candidate) => candidate === String.raw`C:\ProgramData\miniconda3\envs\qlib\python.exe`,
    })).toBe(String.raw`C:\ProgramData\miniconda3\envs\qlib\python.exe`)
  })

  it('falls back to the Windows PATH command', () => {
    expect(resolvePythonExecutable({ platform: 'win32', exists: () => false })).toBe('python')
  })

  it('uses the standard Linux interpreter when present', () => {
    expect(resolvePythonExecutable({
      platform: 'linux',
      exists: (candidate) => candidate === '/usr/bin/python3',
    })).toBe('/usr/bin/python3')
  })

  it('supports Apple Silicon and Intel Homebrew on macOS', () => {
    expect(resolvePythonExecutable({
      platform: 'darwin',
      exists: (candidate) => candidate === '/opt/homebrew/bin/python3',
    })).toBe('/opt/homebrew/bin/python3')
    expect(resolvePythonExecutable({
      platform: 'darwin',
      exists: (candidate) => candidate === '/usr/local/bin/python3',
    })).toBe('/usr/local/bin/python3')
  })

  it('falls back to python3 from PATH on Unix', () => {
    expect(resolvePythonExecutable({ platform: 'linux', exists: () => false })).toBe('python3')
    expect(resolvePythonExecutable({ platform: 'darwin', exists: () => false })).toBe('python3')
  })
})
