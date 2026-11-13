import { spawn } from 'node:child_process';

const processes = [
  spawn(process.execPath, ['server.js'], { stdio: 'inherit' }),
  spawn(process.execPath, ['node_modules/vite/bin/vite.js'], { stdio: 'inherit' })
];

function shutdown() {
  for (const child of processes) child.kill();
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
processes.forEach(child => child.on('exit', code => {
  if (code && code !== 0) process.exitCode = code;
}));
