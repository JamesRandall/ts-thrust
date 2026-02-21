import { defineConfig, type Plugin } from 'vite';
import { transform } from 'esbuild';

// Plugin to compile AudioWorklet .ts files emitted via new URL() to JavaScript
function audioWorkletPlugin(): Plugin {
  return {
    name: 'compile-audioworklet',
    apply: 'build',
    async generateBundle(_options, bundle) {
      const renames: Array<{ oldName: string; newName: string }> = [];

      // First pass: compile .ts assets to .js and track renames
      for (const [key, chunk] of Object.entries(bundle)) {
        if (chunk.type === 'asset' && key.endsWith('.ts')) {
          const result = await transform(String(chunk.source), {
            loader: 'ts',
            format: 'esm',
            target: 'es2020',
          });
          const oldFileName = chunk.fileName;
          const newFileName = oldFileName.replace(/\.ts$/, '.js');
          renames.push({ oldName: oldFileName, newName: newFileName });

          delete bundle[key];
          bundle[newFileName] = {
            type: 'asset',
            fileName: newFileName,
            name: chunk.name,
            needsCodeReference: (chunk as any).needsCodeReference,
            originalFileName: (chunk as any).originalFileName,
            originalFileNames: (chunk as any).originalFileNames,
            names: (chunk as any).names,
            source: result.code,
          };
        }
      }

      // Second pass: update references in JS chunks
      for (const chunk of Object.values(bundle)) {
        if (chunk.type === 'chunk') {
          let code = chunk.code;
          for (const { oldName, newName } of renames) {
            code = code.replaceAll(oldName, newName);
          }
          chunk.code = code;
        }
      }
    },
  };
}

export default defineConfig({
  plugins: [audioWorkletPlugin()],
});
