import {expect} from 'chai';
// eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
const Database = require('better-sqlite3'); // no type declarations
import {SQLiteLike} from '../../../../../src/backend/model/database/SQLiteLike';

describe('SQLiteLike', () => {
  const db = new Database(':memory:');
  SQLiteLike.register(db);
  db.exec('CREATE TABLE t (name TEXT)');
  const names = ['Noël à Biarritz', 'ÉTÉ 2015', 'été', 'Krikštynos', 'Šimtadienis', '100%_done', 'plain'];
  const insert = db.prepare('INSERT INTO t VALUES (?)');
  names.forEach((n) => insert.run(n));
  const like = (pattern: string, escape?: string): string[] =>
    (db.prepare('SELECT name FROM t WHERE name LIKE ?' + (escape ? ` ESCAPE '${escape}'` : '') + ' ORDER BY rowid')
      .all(pattern) as { name: string }[]).map((r) => r.name);

  it('should ignore case and accents', () => {
    expect(like('%noel%')).to.deep.equal(['Noël à Biarritz']);
    expect(like('%NOËL%')).to.deep.equal(['Noël à Biarritz']);
    expect(like('%ete%')).to.deep.equal(['ÉTÉ 2015', 'été']);
    expect(like('%été%')).to.deep.equal(['ÉTÉ 2015', 'été']);
    expect(like('%KRIKŠ%')).to.deep.equal(['Krikštynos']);
    expect(like('simtadienis')).to.deep.equal(['Šimtadienis']);
  });

  it('should keep the LIKE wildcards and escape', () => {
    expect(like('pla_n')).to.deep.equal(['plain']);
    expect(like('pla%')).to.deep.equal(['plain']);
    expect(like('plai')).to.deep.equal([]);
    expect(like('%\\%\\_%', '\\')).to.deep.equal(['100%_done']);
    expect(like('%\\%x%', '\\')).to.deep.equal([]);
    expect(db.prepare('SELECT name FROM t WHERE name NOT LIKE ?').all('%e%').length).to.equal(2);
  });

  it('should give NULL for NULL', () => {
    expect(db.prepare('SELECT NULL LIKE \'%\' AS r').get()).to.deep.equal({r: null});
  });
});
