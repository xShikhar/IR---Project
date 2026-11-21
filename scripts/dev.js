import { spawn, execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const isWin = process.platform === 'win32';
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const clientRequire = createRequire(path.join(projectRoot, 'client', 'package.json'));
const viteRoot = path.dirname(clientRequire.resolve('vite/package.json'));

console.log('[TurnTrace 2] Starting API (port 3101) and React workspace (port 3100)...');

const server = spawn(process.execPath, ['--watch', 'server/src/api/server.js'], {
  cwd: projectRoot,
  stdio: 'inherit'
});

const client = spawn(process.execPath, [path.join(viteRoot, 'bin', 'vite.js')], {
  cwd: path.join(projectRoot, 'client'),
  stdio: 'inherit'
});

let isCleaningUp = false;

function killProcess(child) {
  if (!child || child.killed || !child.pid) return;
  try {
    if (isWin) {
      // On Windows with shell: true, child.kill() only terminates the outer shell wrapper.
      // Use taskkill /T /F to terminate the entire process tree (preventing orphaned background ports).
      execSync(`taskkill /pid ${child.pid} /T /F`, { stdio: 'ignore' });
    } else {
      child.kill('SIGTERM');
    }
  } catch {
    try {
      child.kill('SIGTERM');
    } catch {
      // Process already terminated
    }
  }
}

function cleanup(exitCode = 0) {
  if (isCleaningUp) return;
  isCleaningUp = true;

  console.log('\n[TurnTrace Dev] Shutting down services...');
  killProcess(server);
  killProcess(client);
  process.exit(exitCode);
}

// Handle OS termination signals
process.on('SIGINT', () => cleanup(0));
process.on('SIGTERM', () => cleanup(0));

// Handle spawn errors to prevent uncaughtException crash
server.on('error', (err) => {
  console.error(`[TurnTrace Dev] Failed to start Server: ${err.message}`);
  cleanup(1);
});

client.on('error', (err) => {
  console.error(`[TurnTrace Dev] Failed to start Client: ${err.message}`);
  cleanup(1);
});

// Handle child process exits
server.on('exit', (code, signal) => {
  if (isCleaningUp) return;
  if (code !== 0 && code !== null) {
    console.error(`[TurnTrace Dev] Server exited with code ${code}`);
    cleanup(code);
  } else if (signal) {
    console.log(`[TurnTrace Dev] Server terminated by signal ${signal}`);
    cleanup(0);
  } else {
    console.log('[TurnTrace Dev] Server stopped.');
    cleanup(0);
  }
});

client.on('exit', (code, signal) => {
  if (isCleaningUp) return;
  if (code !== 0 && code !== null) {
    console.error(`[TurnTrace Dev] Client exited with code ${code}`);
    cleanup(code);
  } else if (signal) {
    console.log(`[TurnTrace Dev] Client terminated by signal ${signal}`);
    cleanup(0);
  } else {
    console.log('[TurnTrace Dev] Client stopped.');
    cleanup(0);
  }
});
