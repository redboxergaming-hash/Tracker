import { spawn } from 'node:child_process';

function isBlockedDownloadError(output) {
  const text = output.toLowerCase();
  return text.includes('403') || text.includes('domain forbidden') || text.includes('download failed') || text.includes('failed to download');
}

const args = process.argv.slice(2);
const child = spawn('npx', ['playwright', 'install', ...args], { stdio: ['inherit', 'pipe', 'pipe'], shell: true });

let logs = '';
child.stdout.on('data', (chunk) => {
  const text = chunk.toString();
  logs += text;
  process.stdout.write(text);
});
child.stderr.on('data', (chunk) => {
  const text = chunk.toString();
  logs += text;
  process.stderr.write(text);
});

child.on('exit', (code) => {
  if (code === 0) process.exit(0);

  if (isBlockedDownloadError(logs)) {
    console.warn('\nPlaywright browser download appears blocked in this environment (e.g. CDN 403 / domain forbidden).');
    console.warn('Run this on a machine with browser-download access: npx playwright install');
    console.warn('Continuing without failing the pipeline in this restricted environment.');
    process.exit(0);
  }

  process.exit(code ?? 1);
});
