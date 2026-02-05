#!/usr/bin/env bun
import { parquetReadObjects } from 'hyparquet';

async function validateParquet(): Promise<void> {
  const file = await Bun.file('data/docs.parquet').arrayBuffer();

  const rows = (await parquetReadObjects({ file })) as Array<{
    url: string;
    title: string;
    content: string;
    word_count: number;
    meta: string;
    fetched_at: string;
  }>;

  console.log(`✓ Row count: ${rows.length}`);

  const emptyContent = rows.filter((r) => !r.content || r.content.length === 0);
  console.log(`✓ Empty content: ${emptyContent.length}`);

  const uniqueUrls = new Set(rows.map((r) => r.url));
  const duplicates = rows.length - uniqueUrls.size;
  console.log(`✓ Duplicate URLs: ${duplicates}`);

  const knownPage = rows.find((r) => r.url === '/apollo/recalling-releases/recall-ranges/');
  console.log(`✓ Known page exists: ${!!knownPage}`);
  console.log(`✓ Known page content length: ${knownPage?.content?.length || 0}`);

  // Validation checks
  const checks = [
    { name: 'Row count >= 3600', pass: rows.length >= 3600 },
    { name: 'No empty content', pass: emptyContent.length === 0 },
    { name: 'No duplicate URLs', pass: duplicates === 0 },
    { name: 'Known page exists', pass: !!knownPage },
    { name: 'Known page has content', pass: (knownPage?.content?.length || 0) > 100 },
  ];

  console.log('\nValidation Results:');
  let allPassed = true;
  for (const check of checks) {
    const status = check.pass ? '✓' : '✗';
    console.log(`${status} ${check.name}`);
    if (!check.pass) allPassed = false;
  }

  if (!allPassed) {
    console.error('\n❌ Validation FAILED');
    process.exit(1);
  }

  console.log('\n✅ All validation checks PASSED');
}

validateParquet().catch((error) => {
  console.error('Validation error:', error);
  process.exit(1);
});
