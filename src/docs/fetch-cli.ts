/* eslint-disable no-console */
import { fetchAllDocs } from './fetch.ts';
import { mkdirSync } from 'node:fs';
import fs from 'node:fs';
import { join } from 'node:path';

async function main() {
  try {
    // Create data/ directory
    const dataDir = join(process.cwd(), 'data');
    mkdirSync(dataDir, { recursive: true });

    // Resolve output path
    const dbPath = join(dataDir, 'docs.parquet');

    // Fetch
    const result = await fetchAllDocs(dbPath, {
      progressEvery: 250,
      onProgress: (event) => {
        if (event.type === 'discovered') {
          console.log(`Discovered ${event.totalPages} pages...`);
          return;
        }
        if (event.type === 'progress') {
          console.log(`Processed ${event.processedPages}/${event.totalPages} pages...`);
        }
      },
    });

    const summary = {
      generatedAt: new Date().toISOString(),
      totalPages: result.totalPages,
      fetchedPages: result.fetchedPages,
      failedPages: result.failedUrls.length,
      failedUrls: result.failedUrls,
      dbPath: result.dbPath,
    };

    const summaryPath: string | undefined = process.env.DOCS_SUMMARY_PATH;
    if (summaryPath && summaryPath.trim().length > 0) {
      const resolvedSummaryPath = summaryPath.trim();
      const summaryDir = resolvedSummaryPath.includes('/')
        ? resolvedSummaryPath.slice(0, resolvedSummaryPath.lastIndexOf('/'))
        : '';
      if (summaryDir.length > 0) {
        mkdirSync(summaryDir, { recursive: true });
      }
      fs.writeFileSync(resolvedSummaryPath, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
      console.log(`Wrote summary to ${resolvedSummaryPath}`);
    }

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
