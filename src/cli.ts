import { loadConfig } from './config.js';
import { migrate } from './db/migrate.js';
import { createPool } from './db/pool.js';
import { JobRunner } from './jobs/runner.js';
import { markAbandonedRuns } from './jobs/runs.js';
import { startScheduler } from './jobs/scheduler.js';
import { buildReport, reportAsText } from './report/dataQuality.js';
import { loadScope } from './scope.js';
import { smokeTest } from './smoke.js';
import { createServer } from './web/server.js';

const HELP = `Commands:
  serve       Start the search page (and the automatic schedule, if switched on)
  smoke       Check the Ingram connection: sign in, fetch one page, price a few products
  catalog     Run a full catalog pull now
  refresh     Refresh prices & stock now
  report      Print the data-quality report
  migrate     Set up or update the database`;

async function main(): Promise<number> {
  const command = process.argv[2];
  if (!command || command === 'help' || command === '--help') {
    console.log(HELP);
    return 0;
  }
  if (command === 'smoke') {
    // No database needed for the connection check.
    return (await smokeTest(loadScope(process.env.SCOPE_FILE?.trim() || 'config/scope.json'))) ? 0 : 1;
  }

  const config = loadConfig();
  const db = createPool(config.databaseUrl);
  const ran = await migrate(db);
  if (ran.length) console.log(`Database updated: ${ran.join(', ')}`);

  switch (command) {
    case 'migrate':
      await db.end();
      return 0;
    case 'serve': {
      loadScope(config.scopeFile); // fail fast on a broken scope file
      await markAbandonedRuns(db);
      const runner = new JobRunner(db, config.scopeFile);
      startScheduler(config.schedule, runner);
      if (!config.schedule.enabled) console.log('Automatic schedule is OFF; use the Updates page to refresh.');
      createServer(db, runner, () => loadScope(config.scopeFile)).listen(config.port, () => {
        console.log(`Search page ready on port ${config.port}`);
      });
      return -1; // keep running
    }
    case 'catalog':
    case 'refresh': {
      const runner = new JobRunner(db, config.scopeFile);
      try {
        const result = await runner.run(command === 'catalog' ? 'catalog' : 'price_stock', 'command');
        console.log(result.summary);
        return result.status === 'failed' ? 1 : 0;
      } finally {
        await db.end();
      }
    }
    case 'report':
      console.log(reportAsText(await buildReport(db)));
      await db.end();
      return 0;
    default:
      console.error(`Unknown command "${command}".\n${HELP}`);
      await db.end();
      return 2;
  }
}

main().then(
  (code) => {
    if (code >= 0) process.exit(code);
  },
  (err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  },
);
