import { parquetReadObjects } from 'hyparquet';

export type PageRecord = {
  url: string;
  title: string;
  content: string;
  wordCount: number;
  meta: Record<string, unknown>;
  fetchedAt: string;
};

type PageListing = {
  url: string;
  title: string;
};

export type ParquetStore = {
  file: ArrayBuffer;
  index: PageListing[];
  urlToRow: Map<string, number>;
};

export async function createDatabase(path: string): Promise<ParquetStore> {
  const file = await Bun.file(path).arrayBuffer();

  const rows = await parquetReadObjects({ file, columns: ['url', 'title'] });
  const index: PageListing[] = [];
  const urlToRow = new Map<string, number>();

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i] as PageListing;
    index.push({ url: row.url, title: row.title });
    urlToRow.set(row.url, i);
  }

  return { file, index, urlToRow };
}

export async function getPage(store: ParquetStore, url: string): Promise<PageRecord | null> {
  const rowIndex = store.urlToRow.get(url);
  if (rowIndex === undefined) {
    return null;
  }

  const rows = await parquetReadObjects({
    file: store.file,
    rowStart: rowIndex,
    rowEnd: rowIndex + 1,
  });

  if (rows.length === 0) {
    return null;
  }

  const row = rows[0] as Record<string, unknown>;
  return {
    url: row.url as string,
    title: row.title as string,
    content: row.content as string,
    wordCount: row.word_count as number,
    meta: (typeof row.meta === 'string' ? JSON.parse(row.meta) : (row.meta ?? {})) as Record<
      string,
      unknown
    >,
    fetchedAt: row.fetched_at as string,
  };
}

export function getAllPages(store: ParquetStore): PageListing[] {
  return store.index;
}

export function closeDatabase(store: ParquetStore): void {
  store.index = [];
  store.urlToRow.clear();
}
