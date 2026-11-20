'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { savePhoto } from '@/app/dashboard/inventory/actions';
import { copy } from '@/lib/copy';

const LONGEST_SIDE = 480;

/** Picks a photo, shrinks it in the browser and sends the small copy. The full photo never leaves the device. */
export function PhotoPicker({ itemId, has }: { itemId: string; has: boolean }) {
  const [state, setState] = useState<'idle' | 'working' | 'failed'>('idle');
  const router = useRouter();
  const c = copy.inventory;

  async function pick(file: File) {
    setState('working');
    try {
      const picture = await createImageBitmap(file);
      const scale = Math.min(1, LONGEST_SIDE / Math.max(picture.width, picture.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(picture.width * scale));
      canvas.height = Math.max(1, Math.round(picture.height * scale));
      canvas.getContext('2d')!.drawImage(picture, 0, 0, canvas.width, canvas.height);
      const dataUrl = canvas.toDataURL('image/jpeg', 0.82);
      const result = await savePhoto(itemId, dataUrl.slice(dataUrl.indexOf(',') + 1));
      if (!result.ok) throw new Error('refused');
      setState('idle');
      router.refresh();
    } catch {
      setState('failed');
    }
  }

  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <label className="btn-small cursor-pointer">
        {state === 'working' ? c.photoWorking : has ? c.changePhoto : c.addPhoto}
        <input
          type="file"
          accept="image/*"
          className="sr-only"
          data-testid="photo-input"
          disabled={state === 'working'}
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = '';
            if (file) void pick(file);
          }}
        />
      </label>
      {state === 'failed' && <span role="alert" className="text-sm font-bold text-arcade-bumper">{c.photoFailed}</span>}
    </span>
  );
}
