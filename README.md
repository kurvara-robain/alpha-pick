# React + TypeScript + Vite

## Cross-platform runtime

The Vite API plugins launch Python through `ALPHAMIND_PYTHON`. If it is not set,
Windows checks `C:\ProgramData\miniconda3\envs\qlib\python.exe` and Unix keeps
the existing `python3` behavior. All project paths are resolved from the source
tree, so services do not depend on their process working directory.

PowerShell example:

```powershell
$env:ALPHAMIND_PYTHON = 'C:\ProgramData\miniconda3\envs\qlib\python.exe'
npm ci
npm run dev -- --host 0.0.0.0 --port 7200
```

Bash/zsh example (the environment variable is optional when `python3` is on
`PATH` or available at `/usr/bin/python3`):

```bash
export ALPHAMIND_PYTHON=/path/to/venv/bin/python
npm ci
npm run dev -- --host 0.0.0.0 --port 7200
```

Python scripts explicitly read and write project data as UTF-8. Their Windows
stdio is also normalized to UTF-8, so they can be called directly from Task
Scheduler without relying on the active console code page.

The `/api/*` endpoints are Vite middleware and are available through both
`npm run dev` and `npm run preview -- --host 0.0.0.0 --port 7200`. A static
`dist/` deployment alone does not provide them; keep the preview process running
behind IIS, or move the middleware to a dedicated Node service.

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Babel](https://babeljs.io/) (or [oxc](https://oxc.rs) when used in [rolldown-vite](https://vite.dev/guide/rolldown)) for Fast Refresh
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/) for Fast Refresh

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the ESLint configuration

If you are developing a production application, we recommend updating the configuration to enable type-aware lint rules:

```js
export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...

      // Remove tseslint.configs.recommended and replace with this
      tseslint.configs.recommendedTypeChecked,
      // Alternatively, use this for stricter rules
      tseslint.configs.strictTypeChecked,
      // Optionally, add this for stylistic rules
      tseslint.configs.stylisticTypeChecked,

      // Other configs...
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])
```

You can also install [eslint-plugin-react-x](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-x) and [eslint-plugin-react-dom](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-dom) for React-specific lint rules:

```js
// eslint.config.js
import reactX from 'eslint-plugin-react-x'
import reactDom from 'eslint-plugin-react-dom'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...
      // Enable lint rules for React
      reactX.configs['recommended-typescript'],
      // Enable lint rules for React DOM
      reactDom.configs.recommended,
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])
```
