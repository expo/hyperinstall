import { execAsync } from './exec';

export function execYarnInstallAsync(packagePath) {
  return execAsync('yarn', ['--pure-lockfile'], {
    cwd: packagePath,
    stdio: 'inherit',
  });
}
