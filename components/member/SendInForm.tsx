'use client';

import { useId, useState } from 'react';
import { copy } from '@/lib/copy';
import { LINK_MAX, NOTE_MAX } from '@/lib/submit-limits';

// A message when it did not work, null when it did.
type Send = { (note: string, link: string): Promise<string | null> };

/**
 * The small form on a task card that needs a lead's check: a note and a
 * link, both optional, and the button that sends them in. onSend answers with
 * a message when it did not work, or null when it did.
 */
export function SendInForm({
  onSend,
  onCancel,
}: {
  onSend: Send;
  onCancel: () => void;
}) {
  const id = useId();
  const s = copy.submit;
  const [note, setNote] = useState('');
  const [link, setLink] = useState('');
  const [sending, setSending] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (sending) return;
    setSending(true);
    setProblem(null);
    try {
      const message = await onSend(note, link);
      if (message) setProblem(message);
    } catch {
      setProblem(s.failed);
    } finally {
      setSending(false);
    }
  };

  return (
    <form data-testid="send-in-form" onSubmit={submit} className="mt-4 space-y-3 border-t-2 border-ink/20 pt-4">
      <p className="font-display text-lg">{s.formTitle}</p>
      <div>
        <label className="label" htmlFor={`${id}-note`}>{s.noteLabel}</label>
        <textarea
          id={`${id}-note`}
          rows={3}
          maxLength={NOTE_MAX}
          className="field"
          value={note}
          aria-describedby={`${id}-note-help`}
          onChange={(e) => setNote(e.target.value)}
        />
        <p id={`${id}-note-help`} className="mt-1 text-sm text-ink/70">{s.noteHelp}</p>
      </div>
      <div>
        <label className="label" htmlFor={`${id}-link`}>{s.linkLabel}</label>
        <input
          id={`${id}-link`}
          type="text"
          inputMode="url"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          maxLength={LINK_MAX}
          className="field"
          value={link}
          aria-describedby={`${id}-link-help`}
          onChange={(e) => setLink(e.target.value)}
        />
        <p id={`${id}-link-help`} className="mt-1 text-sm text-ink/70">{s.linkHelp}</p>
      </div>
      {problem && (
        <p role="alert" className="rounded-lg border-2 border-ink bg-arcade-bumper px-3 py-2 text-base font-semibold text-paper">
          {problem}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
        <button type="submit" disabled={sending} className="btn-pill bg-arcade-mint text-ink !shadow-none">
          {sending ? s.sending : s.send}
        </button>
        <button type="button" onClick={onCancel} className="text-sm font-bold underline underline-offset-4">
          {s.cancel}
        </button>
      </div>
    </form>
  );
}
