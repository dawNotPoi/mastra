import type { Collection } from 'mongodb';
import { describe, expect, it, vi } from 'vitest';

import { MongoDBSkillsStorage } from './index';

type SkillRow = {
  id: string;
  status: 'draft' | 'published';
  authorId: string;
  visibility: 'public';
  createdAt: Date;
  updatedAt: Date;
};

type SkillsQuery = {
  id?: { $in: string[] };
  status?: string;
  authorId?: string;
  visibility?: string;
};

const rows: SkillRow[] = [
  {
    id: 'published-new',
    status: 'published',
    authorId: 'alice',
    visibility: 'public',
    createdAt: new Date('2026-01-03'),
    updatedAt: new Date('2026-01-03'),
  },
  {
    id: 'draft',
    status: 'draft',
    authorId: 'alice',
    visibility: 'public',
    createdAt: new Date('2026-01-02'),
    updatedAt: new Date('2026-01-02'),
  },
  {
    id: 'published-old',
    status: 'published',
    authorId: 'bob',
    visibility: 'public',
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
  },
];

function createStorage() {
  const matches = (row: SkillRow, query: SkillsQuery) =>
    (query.status === undefined || row.status === query.status) &&
    (query.authorId === undefined || row.authorId === query.authorId) &&
    (query.visibility === undefined || row.visibility === query.visibility) &&
    (query.id === undefined || query.id.$in.includes(row.id));

  const countDocuments = vi.fn(async (query: SkillsQuery) => rows.filter(row => matches(row, query)).length);
  const find = vi.fn((query: SkillsQuery) => {
    let selected = rows.filter(row => matches(row, query));
    const cursor = {
      sort(_order: Record<string, number>) {
        return this;
      },
      skip(offset: number) {
        selected = selected.slice(offset);
        return this;
      },
      limit(count: number) {
        selected = selected.slice(0, count);
        return this;
      },
      async toArray() {
        return selected;
      },
    };
    return cursor;
  });

  const collection = { countDocuments, find } as unknown as Collection;
  const storage = new MongoDBSkillsStorage({
    connectorHandler: {
      getCollection: async () => collection,
      close: async () => {},
    },
  });
  return { storage, countDocuments, find };
}

describe('MongoDBSkillsStorage.list filters', () => {
  it('excludes drafts when published status is requested and counts only matches', async () => {
    const { storage, countDocuments, find } = createStorage();

    const result = await storage.list({ status: 'published' });

    expect(result.skills.map(skill => skill.id)).toEqual(['published-new', 'published-old']);
    expect(result.total).toBe(2);
    expect(countDocuments).toHaveBeenCalledWith({ status: 'published' });
    expect(find).toHaveBeenCalledWith({ status: 'published' });
  });

  it('returns no skills for an explicitly empty entity ID set', async () => {
    const { storage, countDocuments, find } = createStorage();

    const result = await storage.list({ entityIds: [] });

    expect(result).toMatchObject({ skills: [], total: 0, page: 0, perPage: 100, hasMore: false });
    expect(countDocuments).toHaveBeenCalledWith({ id: { $in: [] } });
    expect(find).not.toHaveBeenCalled();
  });

  it('restricts a nonempty entity ID set and combines it with status and author', async () => {
    const { storage, countDocuments, find } = createStorage();

    const result = await storage.list({
      entityIds: ['draft', 'published-new', 'missing'],
      status: 'published',
      authorId: 'alice',
    });

    expect(result.skills.map(skill => skill.id)).toEqual(['published-new']);
    expect(result.total).toBe(1);
    const filter = { entityIds: ['draft', 'published-new', 'missing'] };
    expect(countDocuments).toHaveBeenCalledWith({
      id: { $in: filter.entityIds },
      status: 'published',
      authorId: 'alice',
    });
    expect(find).toHaveBeenCalledWith({
      id: { $in: filter.entityIds },
      status: 'published',
      authorId: 'alice',
    });
  });

  it('paginates after filtering and keeps the filtered total on every page', async () => {
    const { storage } = createStorage();

    const first = await storage.list({ status: 'published', page: 0, perPage: 1 });
    const second = await storage.list({ status: 'published', page: 1, perPage: 1 });
    const beyond = await storage.list({ status: 'published', page: 2, perPage: 1 });

    expect(first).toMatchObject({ total: 2, page: 0, perPage: 1, hasMore: true });
    expect(first.skills.map(skill => skill.id)).toEqual(['published-new']);
    expect(second).toMatchObject({ total: 2, page: 1, perPage: 1, hasMore: false });
    expect(second.skills.map(skill => skill.id)).toEqual(['published-old']);
    expect(beyond).toMatchObject({ skills: [], total: 2, page: 2, perPage: 1, hasMore: false });
  });
});
