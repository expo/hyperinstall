import childProcess from 'child_process';
import util from 'util';

export function execNpmInstallAsync(packagePath) {
  return new Promise((resolve, reject) => {
    execNpmInstall(packagePath, (error, code) => {
      if (error) {
        reject(error);
      } else {
        resolve(code);
      }
    });
  });
}

export function execNpmInstall(packagePath, callback) {
  let child = childProcess.spawn('npm', ['install'], {
    cwd: packagePath,
    stdio: 'inherit',
  });

  child.on('error', (error) => {
    child.removeAllListeners();
    callback(error);
  });

  child.on('exit', (code, signal) => {
    child.removeAllListeners();
    let error;
    if (code) {
      let message = util.format('npm install failed in %s', packagePath);
      error = new Error(message);
      error.errno = code;
      error.code = signal;
    }
    callback(error, code);
  });
}
