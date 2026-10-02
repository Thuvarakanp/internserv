import { execFile } from 'node:child_process';

// Never use a shell: args are passed as an array so names can't inject commands.
export function run(cmd, args, { timeoutMs = 15_000 } = {}) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: timeoutMs, maxBuffer: 5 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) return reject(new Error((stderr || err.message).trim()));
      resolve(stdout);
    });
  });
}

export const SAFE_NAME = /^[A-Za-z0-9@._:-]{1,128}$/;
