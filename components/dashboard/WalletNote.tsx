import { copy } from '@/lib/copy';
import { walletAvailable, walletIsStandIn } from '@/lib/wallet';

/** For a lead: whether wallet passes are on, what goes to the pass service, and what the free plan cannot do. */
export function WalletNote() {
  const w = copy.wallet;
  const on = walletAvailable();
  const standIn = walletIsStandIn();
  return (
    <section data-testid="wallet-note" className="card p-4">
      <h2 className="text-xl">{w.noteTitle}</h2>
      <p className="mt-2">{standIn ? w.noteStandIn : on ? w.noteOn : w.noteOff}</p>
      {on && !standIn && (
        <>
          <p className="mt-2">{w.noteFree}</p>
          <p className="mt-2">{w.noteSent}</p>
          <p className="mt-2">{w.noteLimit}</p>
          <p className="mt-2">{w.noteRekey}</p>
        </>
      )}
    </section>
  );
}
