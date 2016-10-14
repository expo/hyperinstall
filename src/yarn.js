import { execAsync } from './exec';

export function execYarnInstallAsync(packagePath) {
  return execAsync('yarn', [], { cwd: packagePath, stdio: 'inherit' });
}
