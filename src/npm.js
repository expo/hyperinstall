import { execAsync } from './exec';

export function execNpmInstallAsync(packagePath) {
  return execAsync('npm', ['install'], { cwd: packagePath, stdio: 'inherit' });
}
