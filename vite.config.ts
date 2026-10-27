import { defineConfig, type Plugin } from 'vite';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { publicQuestions, publicRubric } from './scripts/content.mjs';

const ROOT = dirname(fileURLToPath(import.meta.url));

// The pages get the questions and the rubric from the content files at build
// time, with the answer keys, skills and readiness bar removed. Only Apps
// Script ever sees the keys.
function contentModules(): Plugin {
  const files: Record<string, string> = {
    'virtual:participant-questions': 'content/participant-questions.json',
    'virtual:trainer-questions': 'content/trainer-questions.json',
    'virtual:rubric': 'content/teachback-rubric.json',
  };
  return {
    name: 'course-content',
    resolveId(id) {
      return id in files ? '\0' + id : null;
    },
    load(id) {
      if (!id.startsWith('\0virtual:')) return null;
      const name = id.slice(1);
      const path = resolve(ROOT, files[name]);
      this.addWatchFile(path);
      const raw = JSON.parse(readFileSync(path, 'utf8'));
      const data = name === 'virtual:rubric' ? publicRubric(raw) : publicQuestions(raw);
      return `export default ${JSON.stringify(data)};`;
    },
  };
}

export default defineConfig(({ command }) => {
  const apiUrl = process.env.API_URL || '';
  if (command === 'build' && !apiUrl && !process.env.ALLOW_EMPTY_API_URL) {
    throw new Error('API_URL is not set. Set it to the Apps Script web app URL (it ends in /exec).');
  }
  return {
    root: 'site',
    publicDir: false,
    plugins: [contentModules()],
    define: {
      __API_URL__: JSON.stringify(apiUrl),
    },
    build: {
      outDir: '../dist',
      emptyOutDir: true,
      assetsInlineLimit: 0,
      rollupOptions: {
        input: {
          check: resolve(ROOT, 'site/check/index.html'),
          trainer: resolve(ROOT, 'site/trainer/index.html'),
          score: resolve(ROOT, 'site/trainer/score/index.html'),
          show: resolve(ROOT, 'site/show/index.html'),
        },
      },
    },
  };
});
