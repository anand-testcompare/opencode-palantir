import { describe, it, expect } from 'vitest';
import { Database } from 'bun:sqlite';

describe('Example Tests', () => {
  it('should pass a basic arithmetic test', () => {
    expect(1 + 1).toBe(2);
  });

  it('bun:sqlite import works', () => {
    const db = new Database(':memory:');
    expect(db).toBeDefined();
    db.close();
  });
});
