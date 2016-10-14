import childProcess from 'child_process';
import util from 'util';

export function execAsync(command, args, options) {
  return new Promise((resolve, reject) => {
    exec(command, args, options, (error, code) => {
      if (error) {
        reject(error);
      } else {
        resolve(code);
      }
    });
  });
}

export function exec(command, args, options, callback) {
  let child = childProcess.spawn(command, args, options);

  child.on('error', (error) => {
    child.removeAllListeners();
    callback(error);
  });

  child.on('exit', (code, signal) => {
    child.removeAllListeners();
    let error;
    if (code) {
      let message = util.format(
        '%s failed%s',
        [command, ...args].join(' '),
        options.cwd ? ` in ${options.cwd}` : '',
      );
      error = new Error(message);
      error.errno = code;
      error.code = signal;
    }
    callback(error, code);
  });
}
