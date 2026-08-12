/**
 * A minimal async mutex. Replaces the "await-lock" dependency.
 */
export default class Lock {
  #locked = false;
  #waiters = [];

  async acquireAsync() {
    if (!this.#locked) {
      this.#locked = true;
      return;
    }
    await new Promise(resolve => {
      this.#waiters.push(resolve);
    });
  }

  release() {
    let next = this.#waiters.shift();
    if (next) {
      next();
    } else {
      this.#locked = false;
    }
  }
}
