/** Minimal observable value, shaped for React's `useSyncExternalStore`. */
export class Store<T> {
  #value: T;
  #listeners = new Set<() => void>();

  constructor(initial: T) {
    this.#value = initial;
  }

  get(): T {
    return this.#value;
  }

  set(value: T): void {
    if (Object.is(value, this.#value)) return;
    this.#value = value;
    for (const listener of this.#listeners) listener();
  }

  update(updater: (current: T) => T): void {
    this.set(updater(this.#value));
  }

  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };
}
