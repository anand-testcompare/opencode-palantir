/* eslint-disable no-console */
import { fetchAllDocs } from './fetch.ts';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

async function main() {
  try {
    // Create data/ directory
    const dataDir = join(process.cwd(), 'data');
    mkdirSync(dataDir, { recursive: true });

    // Resolve DB path
    const dbPath = join(dataDir, 'docs.db');

    // Fetch
    const result = await fetchAllDocs(dbPath);

    // Log summary
    console.log('\nFetch complete:');
    console.log(`Total pages: ${result.totalPages}`);
    console.log(`Fetched: ${result.fetchedPages}`);
    console.log(`Failed: ${result.failedUrls.length}`);
    if (result.failedUrls.length > 0) {
      console.log('Failed URLs:', result.failedUrls);
    }

    process.exit(0);
  } catch (error) {
    console.error('Fetch failed:', error);
    process.exit(1);
  }
}

main();
