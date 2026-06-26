import { config } from '../config.js';
import { initializeSqliteDatabase } from '../db/sqlite.js';

try {
  const databasePath = await initializeSqliteDatabase(config.sqlitePath);
  console.log(
    JSON.stringify(
      {
        ok: true,
        database: 'sqlite',
        databasePath
      },
      null,
      2
    )
  );
} catch (error) {
  console.error(
    JSON.stringify(
      {
        ok: false,
        database: 'sqlite',
        error: error.message
      },
      null,
      2
    )
  );
  process.exitCode = 1;
}
