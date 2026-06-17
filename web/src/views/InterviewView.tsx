// VIEW 5 — Create Process via Agent Interview (Entrevista guiada). Editor/Admin only (viewers never invoke AI).
// Doc-surface conversation rail (NOT consumer bubbles): agent turns flush-left with a 2px accent left spine;
// operator turns inset on doc-raised. Consumes the interview SSE: start (POST /interviews streams the first
// question) → submit turns (POST /interviews/:draftId/turns streams the next) → finish (POST .../finish) →
// route to Draft Review (VIEW 6). The operator NEVER saves from here — the interview only proposes (D0-6).
// Loading = the "estructurando…" determinate accent bar only (DC-4). "No sé" leaves the field blank (a gap).

import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useI18n } from '../i18n/I18nContext';
import { aiApi } from '../lib/endpoints';
import { errorMessage } from '../lib/hooks';
import { startInterviewStream, submitTurnStream } from '../lib/sse';
import { GhostButton, PrimaryButton, ProgressBar, TextArea } from '../components/primitives';

interface Turn {
  role: 'agent' | 'operator';
  text: string;
}

export default function InterviewView(): JSX.Element {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [draftId, setDraftId] = useState<string | null>(null);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [streaming, setStreaming] = useState('');
  const [busy, setBusy] = useState(false);
  const [answer, setAnswer] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [finished, setFinished] = useState(false);
  const [isComplete, setIsComplete] = useState(false);
  const startedRef = useRef(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Start the interview once on mount.
  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    setBusy(true);
    setStreaming('');
    let acc = '';
    startInterviewStream(
      { language: 'es' },
      {
        onDelta: (text) => {
          acc += text;
          setStreaming(acc);
        },
        onDone: (frame) => {
          setDraftId(frame.draft_id ?? null);
          setTurns([{ role: 'agent', text: frame.assistant_message || acc }]);
          setStreaming('');
          setIsComplete(frame.is_complete);
        },
        onError: () => setError(t('interview.error')),
      },
    )
      .catch(() => setError(t('interview.error')))
      .finally(() => setBusy(false));
  }, [t]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [turns, streaming]);

  async function send(text: string): Promise<void> {
    if (!draftId || !text.trim() || busy) return;
    setError(null);
    setTurns((arr) => [...arr, { role: 'operator', text }]);
    setAnswer('');
    setBusy(true);
    setStreaming('');
    let acc = '';
    try {
      const frame = await submitTurnStream(draftId, text, {
        onDelta: (d) => {
          acc += d;
          setStreaming(acc);
        },
        onDone: (f) => {
          setTurns((arr) => [...arr, { role: 'agent', text: f.assistant_message || acc }]);
          setStreaming('');
          setIsComplete(f.is_complete);
        },
        onError: () => setError(t('interview.error')),
      });
      // The server auto-finishes when the agent signals completion; route to review.
      if (frame.is_complete) await goToReview();
    } catch {
      setError(t('interview.error'));
    } finally {
      setBusy(false);
    }
  }

  async function goToReview(): Promise<void> {
    if (!draftId) return;
    setFinished(true);
    try {
      // finish is idempotent enough: if the turn already auto-finished, this returns ready_for_review.
      await aiApi.finishInterview(draftId).catch(() => undefined);
      navigate(`/draft/${draftId}`);
    } catch (err) {
      setError(errorMessage(err, t('interview.error')));
      setFinished(false);
    }
  }

  return (
    <div className="grid min-h-[calc(100vh-48px)] grid-cols-1 bg-doc-bg lg:grid-cols-2">
      {/* Conversation rail (doc surface) */}
      <div className="flex h-[calc(100vh-48px)] flex-col border-r border-board-line bg-doc-surface text-ink">
        <div className="flex items-center justify-between border-b border-doc-line px-5 py-3">
          <h1 className="text-base font-semibold">{t('interview.title')}</h1>
          <GhostButton surface="doc" className="py-1 text-2xs" onClick={() => navigate('/create')}>
            {t('common.cancel')}
          </GhostButton>
        </div>

        <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
          {turns.map((turn, i) =>
            turn.role === 'agent' ? (
              <div key={i} className="border-l-2 border-accent pl-3 text-base leading-wiki text-ink">
                {turn.text}
              </div>
            ) : (
              <div key={i} className="ml-6 rounded-sm bg-doc-raised px-3 py-2 text-base leading-wiki text-ink">
                {turn.text}
              </div>
            ),
          )}
          {streaming && <div className="border-l-2 border-accent pl-3 text-base leading-wiki text-ink">{streaming}</div>}
          {busy && !streaming && <ProgressBar label={t('interview.structuring')} />}
          {error && (
            <div className="rounded-sm border border-status-red bg-status-red/5 px-3 py-2 text-sm text-status-red-doc">
              {error}
            </div>
          )}
        </div>

        <div className="border-t border-doc-line px-5 py-3">
          <TextArea
            value={answer}
            onChange={(e) => setAnswer(e.target.value)}
            placeholder={t('interview.placeholder')}
            disabled={busy || finished || !draftId}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void send(answer);
              }
            }}
          />
          <div className="mt-2 flex items-center justify-between gap-2">
            <GhostButton surface="doc" className="py-1 text-2xs" disabled={busy || finished || !draftId} onClick={() => void send(t('interview.dontKnow'))}>
              {t('interview.dontKnow')}
            </GhostButton>
            <div className="flex gap-2">
              <GhostButton surface="doc" disabled={busy || finished || !draftId} onClick={() => void goToReview()}>
                {finished ? t('interview.ending') : t('interview.end')}
              </GhostButton>
              <PrimaryButton disabled={busy || finished || !answer.trim() || !draftId} onClick={() => void send(answer)}>
                {t('interview.send')}
              </PrimaryButton>
            </div>
          </div>
        </div>
      </div>

      {/* Live draft preview placeholder (board surface): the structure forms as the interview proceeds. The
          authoritative draft is rendered on Draft Review; here we show progress + a hint to keep the cockpit feel. */}
      <div className="hidden bg-board-bg p-6 text-ink-onboard lg:block">
        <div className="text-xs uppercase tracking-label text-ink-onboard-muted">{t('interview.draftPreview')}</div>
        <p className="mt-3 text-sm leading-wiki text-ink-onboard-muted">{t('draft.aiNotice')}</p>
        <div className="mt-6 space-y-2">
          {turns
            .filter((x) => x.role === 'operator')
            .map((x, i) => (
              <div key={i} className="rounded-sm border border-board-line bg-board-raised px-3 py-2 text-sm">
                <span className="font-mono tabular-nums text-ink-onboard-muted">{i + 1}</span> · {x.text.slice(0, 80)}
              </div>
            ))}
        </div>
        {isComplete && (
          <div className="mt-6">
            <PrimaryButton onClick={() => void goToReview()}>{t('interview.end')}</PrimaryButton>
          </div>
        )}
      </div>
    </div>
  );
}
