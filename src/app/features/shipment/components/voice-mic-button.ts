import { ChangeDetectionStrategy, Component, OnDestroy, output, signal } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { SpeechSession, speechRecognitionSupported, startSpeechRecognition } from '@core/services/speech-recognition.util';

interface VoiceLangOption { code: string; label: string; }

/** en-IN default (matches this app's existing dev/company locale); hi-IN and mr-IN cover
 *  the two extra languages voice-booking.util.ts has keyword support for. Only changes
 *  what the browser listens for — the parser itself checks all three languages' keywords
 *  on every transcript regardless of this picker, since booking-desk speech commonly
 *  code-switches between them. */
const VOICE_LANGS: VoiceLangOption[] = [
  { code: 'en-IN', label: 'EN' },
  { code: 'hi-IN', label: 'हिं' },
  { code: 'mr-IN', label: 'मर' }
];

/**
 * Mic button wrapping the browser's Web Speech API (`SpeechRecognition` /
 * `webkitSpeechRecognition`) — Chrome/Edge only, no backend and no API key. Emits the
 * final transcript once recognition ends; the caller owns turning that text into
 * structured fields (see `voice-booking.util.ts`).
 */
@Component({
  selector: 'app-voice-mic-button',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatIconModule],
  template: `
    <div class="vmb">
      <div class="vmb__langs" role="group" aria-label="Voice language">
        @for (l of langs; track l.code) {
          <button type="button" class="vmb__lang" [class.vmb__lang--active]="lang() === l.code"
                  [disabled]="listening()" (click)="lang.set(l.code)">{{ l.label }}</button>
        }
      </div>
      <button type="button" class="vmb__btn" [class.vmb__btn--live]="listening()" (click)="toggle()" [disabled]="!supported()">
        <span class="vmb__icon">
          <mat-icon>{{ listening() ? 'graphic_eq' : 'auto_awesome' }}</mat-icon>
        </span>
        <span class="vmb__label">{{ listening() ? 'Listening…' : 'AI Voice Booking' }}</span>
      </button>
      @if (!supported()) {
        <span class="vmb__hint">AI voice booking needs Chrome or Edge.</span>
      } @else if (listening() && interim()) {
        <span class="vmb__hint vmb__hint--live">&ldquo;{{ interim() }}&rdquo;</span>
      }
    </div>
  `,
  styles: [`
    .vmb { display:flex; align-items:center; gap:10px; min-width:0; }
    .vmb__langs { display:inline-flex; gap:2px; padding:2px; border-radius:999px; background:var(--surface); border:1px solid var(--surface-border); }
    .vmb__lang { height:28px; min-width:28px; padding:0 8px; border:0; border-radius:999px; background:transparent;
      color:var(--content-muted); font:600 15px var(--font-sans); cursor:pointer; }
    .vmb__lang:hover:not(:disabled) { background:var(--surface-muted); color:var(--content-fg); }
    .vmb__lang--active { background:var(--brand-600); color:#fff; }
    .vmb__lang:disabled { opacity:.5; cursor:not-allowed; }
    .vmb__btn { position:relative; display:inline-flex; align-items:center; gap:7px; height:36px; padding:0 16px 0 12px;
      border-radius:999px; border:none; cursor:pointer; white-space:nowrap; font:700 16px var(--font-sans); color:#fff;
      background:linear-gradient(90deg,#6366f1,#a855f7,#ec4899,#6366f1); background-size:300% 100%;
      animation: vmb-gradient 6s ease infinite; box-shadow:0 1px 8px rgba(147,51,234,.35); }
    .vmb__btn::before { content:''; position:absolute; inset:-2px; border-radius:999px; z-index:-1;
      background:linear-gradient(90deg,#6366f1,#a855f7,#ec4899,#6366f1); background-size:300% 100%;
      animation: vmb-gradient 6s ease infinite; filter:blur(6px); opacity:.55; }
    .vmb__btn:hover:not(:disabled) { box-shadow:0 2px 14px rgba(147,51,234,.5); }
    .vmb__btn:disabled { opacity:.45; cursor:not-allowed; animation:none; box-shadow:none; }
    .vmb__btn:disabled::before { display:none; }
    @keyframes vmb-gradient { 0% { background-position:0% 50%; } 50% { background-position:100% 50%; } 100% { background-position:0% 50%; } }
    .vmb__icon { display:inline-flex; }
    .vmb__icon mat-icon { font-size:18px; width:18px; height:18px; }
    .vmb__btn:not(.vmb__btn--live) .vmb__icon mat-icon { animation: vmb-sparkle 2.2s ease-in-out infinite; }
    @keyframes vmb-sparkle { 0%,100% { transform:scale(1) rotate(0deg); opacity:1; } 50% { transform:scale(1.15) rotate(8deg); opacity:.75; } }
    .vmb__btn--live .vmb__icon mat-icon { animation: vmb-pulse .9s ease-in-out infinite; }
    @keyframes vmb-pulse { 0%,100% { opacity:1; transform:scale(1); } 50% { opacity:.5; transform:scale(1.2); } }
    .vmb__hint { font:400 15px var(--font-sans); color:var(--content-muted); max-width:360px; overflow:hidden;
      text-overflow:ellipsis; white-space:nowrap; }
    .vmb__hint--live { color:var(--brand-600); font-style:italic; }
  `]
})
export class VoiceMicButton implements OnDestroy {
  /** The final recognised transcript, emitted once when recognition ends. */
  readonly transcriptReady = output<string>();
  readonly error = output<string>();

  protected readonly langs = VOICE_LANGS;
  protected readonly lang = signal(VOICE_LANGS[0].code);
  protected readonly listening = signal(false);
  protected readonly interim = signal('');
  protected readonly supported = signal(speechRecognitionSupported());

  private session: SpeechSession | null = null;

  protected toggle(): void {
    if (this.listening()) { this.session?.stop(); return; }
    this.startListening();
  }

  private startListening(): void {
    this.interim.set('');
    const session = startSpeechRecognition(this.lang(), {
      onInterim: (text) => this.interim.set(text),
      onFinal: (text) => this.transcriptReady.emit(text),
      onError: (message) => this.error.emit(message),
      onEnd: () => { this.listening.set(false); this.session = null; }
    });
    if (!session) return;
    this.session = session;
    this.listening.set(true);
  }

  ngOnDestroy(): void { this.session?.abort(); }
}
