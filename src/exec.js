import childProcess from 'node:child_process';

export function execAsync(command, args, options) {
  return new Promise((resolve, reject) => {
    let child = childProcess.spawn(command, args, options);

    child.on('error', error => {
      child.removeAllListeners();
      reject(error);
    });

    child.on('exit', (code, signal) => {
      child.removeAllListeners();
      if (code) {
        let where = options.cwd ? ` in ${options.cwd}` : '';
        let error = new Error(`${[command, ...args].join(' ')} failed${where}`);
        error.status = code;
        error.signal = signal;
        reject(error);
      } else {
        resolve(code);
      }
    });
  });
}

export function execNpmInstallAsync(packagePath) {
  return execAsync('npm', ['install'], { cwd: packagePath, stdio: 'inherit' });
}

export function execYarnInstallAsync(packagePath) {
  return execAsync('yarn', ['--pure-lockfile'], { cwd: packagePath, stdio: 'inherit' });
}
