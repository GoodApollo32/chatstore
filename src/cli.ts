import { loadConfig } from './config.js';
import { migrate } from './db/migrate.js';
import { icecatCheck } from './icecat/check.js';
import { createPool } from './db/pool.js';
import { JobRunner } from './jobs/runner.js';
import { rereadStoredData } from './jobs/reread.js';
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
  icecat      Check how many of our products Icecat has specs and images for (needs ICECAT_USERNAME)
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
      const scope = loadScope(config.scopeFile); // fail fast on a broken scope file
      await markAbandonedRuns(db);
      const reread = await rereadStoredData(db, scope);
      if (reread.leftOut || reread.warehouses || reread.specs || reread.facts) {
        console.log(
          `Re-read stored data: ${reread.leftOut} products now left out by the scope rules, ` +
          `${reread.warehouses} warehouse stock rows re-sorted by country, ${reread.specs} products given specifications, ` +
          `${reread.facts} products' key specs updated from their titles.`,
        );
      }
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
    case 'icecat': {
      const username = process.env.ICECAT_USERNAME?.trim();
      if (!username) {
        console.error('Missing setting ICECAT_USERNAME. Add your Icecat username to the .env file (see the README, "Icecat").');
        await db.end();
        return 1;
      }
      try {
        return (await icecatCheck(db, username)) ? 0 : 1;
      } finally {
        await db.end();
      }
    }
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
