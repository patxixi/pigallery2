/**
 * LIKE for SQLite that ignores case and accents, like MySQL's
 * utf8mb4_general_ci does: SQLite's own LIKE only folds ASCII letters, so
 * searching "noel" did not find "Noël", nor "ÉTÉ" find "été" (#729).
 * Registered on each connection as the like() function, which SQLite calls
 * for the LIKE operator (with the ESCAPE character as third argument).
 */
export class SQLiteLike {
  private static readonly cache = new Map<string, RegExp>();

  /** Lower case, accents removed. */
  public static fold(text: string): string {
    // eslint-disable-next-line no-control-regex
    if (/^[\x00-\x7F]*$/.test(text)) {
      return text.toLowerCase();
    }
    return text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
  }

  public static like(pattern: string, value: unknown, escape?: string): number {
    if (pattern === null || value === null || value === undefined) {
      return null;
    }
    return this.toRegExp(String(pattern), escape).test(this.fold(String(value))) ? 1 : 0;
  }

  public static register(db: { function: (name: string, options: object, fn: (...args: unknown[]) => unknown) => void }): void {
    const options = {deterministic: true, varargs: true};
    db.function('like', options, (pattern: string, value: unknown, escape?: string) =>
      SQLiteLike.like(pattern, value, escape));
  }

  private static toRegExp(pattern: string, escape?: string): RegExp {
    const key = (escape ?? '') + '\u0000' + pattern;
    let re = this.cache.get(key);
    if (!re) {
      let src = '';
      const chars = [...this.fold(pattern)];
      const esc = escape ? this.fold(escape) : null;
      for (let i = 0; i < chars.length; i++) {
        const c = chars[i];
        if (esc && c === esc && i + 1 < chars.length) {
          src += chars[++i].replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        } else if (c === '%') {
          src += '.*';
        } else if (c === '_') {
          src += '.';
        } else {
          src += c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        }
      }
      re = new RegExp('^' + src + '$', 'su');
      if (this.cache.size > 200) {
        this.cache.clear();
      }
      this.cache.set(key, re);
    }
    return re;
  }
}
