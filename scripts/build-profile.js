import { spawnSync } from 'node:child_process';

const env = {
  ...process.env,
  NEO_PROFILE_BUILD: 'true',
};

const result = spawnSync('npm', ['run', 'build'], {
  env,
  shell: true,
  stdio: 'inherit',
});

process.exit(result.status ?? 1);
