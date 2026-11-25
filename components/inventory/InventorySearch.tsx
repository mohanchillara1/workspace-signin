'use client';

import Link from 'next/link';
import { useState } from 'react';
import { copy } from '@/lib/copy';

export type SearchItem = { id: string; name: string; category: string; count: number | null };

const tidy = (text: string) => text.toLowerCase().replace(/\s+/g, ' ').trim();

/** Finds an item by name (or group) across every group, and links straight to it. */
export function InventorySearch({ items, base }: { items: SearchItem[]; base: string }) {
  const [query, setQuery] = useState('');
  const c = copy.inventory;
  const words = tidy(query).split(' ').filter(Boolean);
  const found = words.length
    ? items.filter((item) => {
        const text = tidy(`${item.name} ${item.category}`);
        return words.every((word) => text.includes(word));
      })
    : [];
  return (
    <div data-testid="inventory-search" className="mt-6">
      <label className="label" htmlFor="inventorySearch">{c.searchLabel}</label>
      <input
        id="inventorySearch"
        type="search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder={c.searchPlaceholder}
        autoComplete="off"
        className="field"
      />
      {words.length > 0 && (
        found.length === 0 ? (
          <p data-testid="search-none" className="mt-3 text-paper/70">{c.searchNone}</p>
        ) : (
          <ul data-testid="search-results" className="mt-3 space-y-2">
            {found.slice(0, 50).map((item) => (
              <li key={item.id}>
                <Link
                  href={`${base}?g=${encodeURIComponent(item.category)}#i-${item.id}`}
                  data-result={item.name}
                  className="card flex items-center justify-between gap-3 px-4 py-3"
                >
                  <span className="min-w-0">
                    <span className="block font-bold [overflow-wrap:anywhere]">{item.name}</span>
                    <span className="block text-sm text-ink/70">{item.category}</span>
                  </span>
                  <span className={item.count === null ? 'text-sm text-ink/70' : 'font-display text-2xl'}>
                    {item.count === null ? c.notCounted : item.count}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )
      )}
    </div>
  );
}
