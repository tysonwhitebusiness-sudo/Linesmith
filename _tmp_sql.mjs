// Drive real app query paths so the rewritten compile() is exercised on
// production SQL, not just crafted test strings.
process.env.NODE_ENV='development';
const { pgAll, pgGet, pgRun } = await import('./lib/db/pgClient.ts');
