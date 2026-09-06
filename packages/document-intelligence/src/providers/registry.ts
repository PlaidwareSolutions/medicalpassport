/**
 * Provider registry (docs_v2/09 §7 "Provider selection is configuration per environment").
 *
 * A registry maps a configuration name (`OCR_PROVIDER=tesseract`,
 * `DOCUMENT_AI_PROVIDER=null`) to a factory. Adapters are registered by the process that owns
 * their dependencies — the worker registers Tesseract, a vendor adapter registers itself
 * behind OD-11/OD-12 — and this package only knows the contract. Resolution is lazy so an
 * adapter that needs a daemon or a key is not constructed unless it was selected.
 */
export class ProviderRegistry<T> {
  private readonly factories = new Map<string, () => T>();

  constructor(readonly kind: string) {}

  register(name: string, factory: () => T): this {
    const key = normalizeName(name);
    if (!key) throw new Error(`${this.kind} provider: a name is required`);
    if (this.factories.has(key)) throw new Error(`${this.kind} provider "${key}" is already registered`);
    this.factories.set(key, factory);
    return this;
  }

  has(name: string): boolean {
    return this.factories.has(normalizeName(name));
  }

  names(): string[] {
    return [...this.factories.keys()].sort();
  }

  /** Throws a message that lists what *is* registered, so a typo in an env var is a one-line fix. */
  resolve(name: string): T {
    const key = normalizeName(name);
    const factory = this.factories.get(key);
    if (!factory) {
      throw new Error(`${this.kind} provider "${name}" is not registered (known: ${this.names().join(", ") || "none"})`);
    }
    return factory();
  }
}

function normalizeName(name: string): string {
  return name.trim().toLowerCase();
}
