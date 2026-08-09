import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

/**
 * Exécuteur de migrations SQL.
 *
 * Chaque fichier de `migrations/` est appliqué une seule fois, dans l'ordre
 * lexicographique, à l'intérieur d'une transaction. Une empreinte est stockée :
 * si un fichier déjà appliqué est modifié, la migration échoue au lieu de
 * laisser diverger silencieusement le schéma d'un environnement.
 */

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), '../../migrations');

export interface MigrationResult {
  applied: string[];
  skipped: string[];
}

export async function runMigrations(
  connectionString: string,
  options: { dir?: string; log?: (message: string) => void } = {},
): Promise<MigrationResult> {
  const dir = options.dir ?? MIGRATIONS_DIR;
  const log = options.log ?? (() => {});
  const pool = new pg.Pool({ connectionString, max: 1 });

  try {
    const client = await pool.connect();
    try {
      await client.query(`
        CREATE TABLE IF NOT EXISTS schema_migrations (
          name       TEXT PRIMARY KEY,
          checksum   TEXT NOT NULL,
          applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
      `);

      const files = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort();
      const { rows } = await client.query<{ name: string; checksum: string }>(
        'SELECT name, checksum FROM schema_migrations',
      );
      const alreadyApplied = new Map(rows.map((r) => [r.name, r.checksum]));

      const applied: string[] = [];
      const skipped: string[] = [];

      for (const file of files) {
        const sql = await readFile(join(dir, file), 'utf8');
        const checksum = createHash('sha256').update(sql).digest('hex');
        const previous = alreadyApplied.get(file);

        if (previous !== undefined) {
          if (previous !== checksum) {
            throw new Error(
              `La migration ${file} a été modifiée après application ` +
                `(empreinte ${previous.slice(0, 12)} → ${checksum.slice(0, 12)}). ` +
                'Créer une nouvelle migration plutôt que de modifier celle-ci.',
            );
          }
          skipped.push(file);
          continue;
        }

        log(`→ application de ${file}`);
        await client.query('BEGIN');
        try {
          await client.query(sql);
          await client.query('INSERT INTO schema_migrations (name, checksum) VALUES ($1, $2)', [
            file,
            checksum,
          ]);
          await client.query('COMMIT');
          applied.push(file);
        } catch (error) {
          await client.query('ROLLBACK');
          throw new Error(`Échec de la migration ${file} : ${(error as Error).message}`, {
            cause: error,
          });
        }
      }

      return { applied, skipped };
    } finally {
      client.release();
    }
  } finally {
    await pool.end();
  }
}

// Exécution directe : npm run migrate
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error('DATABASE_URL est obligatoire.');
    process.exit(1);
  }
  runMigrations(connectionString, { log: (m) => console.log(m) })
    .then(({ applied, skipped }) => {
      console.log(
        applied.length > 0
          ? `${applied.length} migration(s) appliquée(s), ${skipped.length} déjà à jour.`
          : `Schéma à jour (${skipped.length} migration(s)).`,
      );
      process.exit(0);
    })
    .catch((error: Error) => {
      console.error(error.message);
      process.exit(1);
    });
}
