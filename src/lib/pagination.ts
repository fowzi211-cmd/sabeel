// Cursor pagination for every list that can grow without bound (orders, fee invoices, reviews,
// payments) — design pack §9's own API convention ("cursor pagination `?cursor=&limit=`"), already
// used by the admin audit log; slice 7 extends the same pattern everywhere else. Always ordered
// newest-first, cursoring on the row's own `id` (unique, so a stable anchor regardless of ties on
// the display-order field).

export const DEFAULT_PAGE_SIZE = 50;

export interface Paginated<T> {
  items: T[];
  nextCursor: string | null;
}

/** Split `limit + 1` fetched rows into this page's items and the next cursor, if there is one. */
export function paginate<T extends { id: string }>(rows: T[], limit: number): Paginated<T> {
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  return { items, nextCursor: hasMore ? items[items.length - 1].id : null };
}
