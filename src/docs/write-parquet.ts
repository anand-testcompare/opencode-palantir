import { parquetWriteBuffer } from 'hyparquet-writer';
import type { PageRecord } from './db.ts';

export async function writeParquet(pages: PageRecord[], outputPath: string): Promise<void> {
  const buffer = parquetWriteBuffer({
    columnData: [
      { name: 'url', data: pages.map((p) => p.url), type: 'STRING' },
      { name: 'title', data: pages.map((p) => p.title), type: 'STRING' },
      { name: 'content', data: pages.map((p) => p.content), type: 'STRING' },
      { name: 'word_count', data: pages.map((p) => p.wordCount), type: 'INT32' },
      { name: 'meta', data: pages.map((p) => p.meta), type: 'JSON' },
      {
        name: 'fetched_at',
        data: pages.map((p) => p.fetchedAt),
        type: 'STRING',
      },
    ],
    codec: 'UNCOMPRESSED',
  });
  await Bun.write(outputPath, buffer);
}
