import { describe, it, expect } from 'vitest';
import { parquetReadObjects } from 'hyparquet';

describe('Example Tests', () => {
  it('should pass a basic arithmetic test', () => {
    expect(1 + 1).toBe(2);
  });

  it('hyparquet import works', () => {
    expect(parquetReadObjects).toBeDefined();
    expect(typeof parquetReadObjects).toBe('function');
  });
});
