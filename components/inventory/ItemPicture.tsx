import type { ReactNode } from 'react';

// An item's photo, or a small drawing for its group until someone adds one.
const INK = '#151515';
const line = { fill: 'none', stroke: INK, strokeWidth: 3, strokeLinecap: 'round', strokeLinejoin: 'round' } as const;

const DRAWINGS: Record<string, { tile: string; shape: ReactNode }> = {
  'Control system': {
    tile: '#B48CFF',
    shape: (
      <>
        <rect x="16" y="16" width="32" height="32" rx="4" {...line} />
        <rect x="26" y="26" width="12" height="12" {...line} />
        <path d="M24 10v6M32 10v6M40 10v6M24 48v6M32 48v6M40 48v6M10 24h6M10 32h6M10 40h6M48 24h6M48 32h6M48 40h6" {...line} />
      </>
    ),
  },
  Motors: {
    tile: '#FF8A5C',
    shape: (
      <>
        <rect x="12" y="20" width="32" height="24" rx="5" {...line} />
        <path d="M44 32h10M20 20v24M28 20v24M36 20v24" {...line} />
      </>
    ),
  },
  'Motor controllers': {
    tile: '#7FB7FF',
    shape: (
      <>
        <rect x="14" y="18" width="36" height="28" rx="4" {...line} />
        <path d="M22 18v-6M32 18v-6M42 18v-6M22 30h20M22 38h12" {...line} />
      </>
    ),
  },
  'Sensors and cameras': {
    tile: '#5FE0B5',
    shape: (
      <>
        <rect x="12" y="20" width="40" height="26" rx="5" {...line} />
        <circle cx="32" cy="33" r="8" {...line} />
        <path d="M22 20l3-6h14l3 6" {...line} />
      </>
    ),
  },
  'Batteries and power': {
    tile: '#FFD23F',
    shape: (
      <>
        <rect x="12" y="22" width="40" height="26" rx="4" {...line} />
        <path d="M20 22v-6h8v6M36 22v-6h8v6M20 35h8M36 35h8M40 31v8" {...line} />
      </>
    ),
  },
  'Wire and connectors': {
    tile: '#FF9BD2',
    shape: (
      <>
        <path d="M10 44c10 0 8-22 20-22s8 20 24 20" {...line} />
        <rect x="6" y="38" width="10" height="12" rx="2" {...line} />
      </>
    ),
  },
  Pneumatics: {
    tile: '#6EE7F0',
    shape: (
      <>
        <circle cx="32" cy="30" r="16" {...line} />
        <path d="M32 30l8-8M32 46v8M24 54h16" {...line} />
      </>
    ),
  },
  'Drivetrain and mechanical': {
    tile: '#9BE15D',
    shape: (
      <>
        <circle cx="32" cy="32" r="14" {...line} />
        <circle cx="32" cy="32" r="4" {...line} />
        <path d="M32 10v8M32 46v8M10 32h8M46 32h8M16 16l6 6M42 42l6 6M48 16l-6 6M22 42l-6 6" {...line} />
      </>
    ),
  },
  Hardware: {
    tile: '#E7C9FF',
    shape: (
      <>
        <path d="M20 12h24l4 8-4 8H20l-4-8z" {...line} />
        <path d="M26 28v24M38 28v24M26 36h12M26 44h12M26 52h12" {...line} />
      </>
    ),
  },
  Tools: {
    tile: '#F2B84B',
    shape: (
      <>
        <path d="M44 12a10 10 0 0 0-11 13L12 46l6 6 21-21a10 10 0 0 0 13-11l-7 7-6-2-2-6z" {...line} />
      </>
    ),
  },
  'Driver station and pit': {
    tile: '#FF5A6E',
    shape: (
      <>
        <path d="M18 22h28a10 10 0 0 1 10 10v6a8 8 0 0 1-14 4l-2-2H24l-2 2a8 8 0 0 1-14-4v-6a10 10 0 0 1 10-10z" {...line} />
        <path d="M20 28v8M16 32h8" {...line} />
        <circle cx="44" cy="32" r="2.5" fill={INK} />
      </>
    ),
  },
  Safety: {
    tile: '#FFF8EE',
    shape: (
      <>
        <rect x="8" y="24" width="20" height="14" rx="6" {...line} />
        <rect x="36" y="24" width="20" height="14" rx="6" {...line} />
        <path d="M28 30h8M8 28l-2-6M56 28l2-6" {...line} />
      </>
    ),
  },
};
const OTHER = { tile: '#d9d5e3', shape: <rect x="16" y="16" width="32" height="32" rx="6" {...line} /> };

export function ItemPicture({ itemId, category, photoVersion, size = 72 }: { itemId: string; category: string; photoVersion: number | null; size?: number }) {
  const frame = 'shrink-0 rounded-lg border-2 border-ink object-cover';
  if (photoVersion !== null) {
    // The item's name is right next to the picture, so the picture needs no words of its own.
    // eslint-disable-next-line @next/next/no-img-element
    return <img data-photo src={`/inventory-photo/${itemId}?v=${photoVersion}`} alt="" width={size} height={size} loading="lazy" className={frame} style={{ width: size, height: size }} />;
  }
  const drawing = DRAWINGS[category] ?? OTHER;
  return (
    <svg data-drawing viewBox="0 0 64 64" width={size} height={size} aria-hidden="true" className={frame} style={{ background: drawing.tile }}>
      {drawing.shape}
    </svg>
  );
}
