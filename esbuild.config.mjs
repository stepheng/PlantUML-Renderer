import * as esbuild from 'esbuild';

const production = process.argv[2] === 'production';

await esbuild.build({
    entryPoints: ['src/extension.ts'],
    bundle: true,
    outfile: 'out/extension.js',
    external: ['vscode'],
    format: 'cjs',
    platform: 'node',
    sourcemap: !production,
    minify: production,
});

await esbuild.build({
    entryPoints: ['src/webview/main.ts'],
    bundle: true,
    outfile: 'out/webview.js',
    format: 'iife',
    platform: 'browser',
    sourcemap: !production,
    minify: production,
});

console.log('Build complete');
