import { copy } from '@/lib/copy';

export default function NotFound() {
  return (
    <main className="flex min-h-dvh items-center justify-center p-6">
      <div className="max-w-md">
        <h1 className="text-4xl">{copy.app.notFoundTitle}</h1>
        <p className="mt-3 text-lg text-paper/85">{copy.app.notFoundBody}</p>
      </div>
    </main>
  );
}
