import plugin from '../dist/index.js';

const worktree = import.meta.dirname + '/..';

const hooks = await plugin({
  worktree,
  directory: worktree,
  project: { root: worktree },
  serverUrl: new URL('http://localhost'),
  client: {} as never,
  $: {} as never,
});

const errors: string[] = [];

const toolNames = Object.keys(hooks.tool ?? {});
if (!toolNames.includes('get_doc_page') || !toolNames.includes('list_all_docs')) {
  errors.push(`Expected tools [get_doc_page, list_all_docs], got [${toolNames.join(', ')}]`);
}

if (typeof hooks['command.execute.before'] !== 'function') {
  errors.push('Missing command.execute.before hook');
}

const listResult = await hooks.tool!.list_all_docs.execute({}, {} as never);
if (typeof listResult !== 'string' || listResult.length === 0) {
  errors.push(`list_all_docs returned empty or non-string: ${typeof listResult}`);
} else if (listResult.includes('database not found')) {
  errors.push(`list_all_docs: database not found — run 'bun run src/docs/fetch-cli.ts' first`);
} else {
  const match = listResult.match(/\((\d+) pages\)/);
  const count = match ? parseInt(match[1], 10) : 0;
  if (count < 100) {
    errors.push(`list_all_docs returned only ${count} pages, expected 3000+`);
  }
  console.log(`✓ list_all_docs: ${count} pages`);
}

const pageResult = await hooks.tool!.get_doc_page.execute(
  { url: '/apollo/recalling-releases/recall-ranges/' },
  {} as never
);
if (typeof pageResult !== 'string' || pageResult.length === 0) {
  errors.push(`get_doc_page returned empty or non-string: ${typeof pageResult}`);
} else if (pageResult.includes('Page not found')) {
  errors.push(`get_doc_page could not find test page`);
} else {
  console.log(`✓ get_doc_page: ${pageResult.length} chars`);
}

if (errors.length > 0) {
  console.error('\n✗ Smoke test failed:');
  errors.forEach((e) => console.error(`  - ${e}`));
  process.exit(1);
} else {
  console.log('\n✓ Smoke test passed — plugin is loadable and tools work');
}
