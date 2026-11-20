import { ChangeDetectionStrategy, Component, OnDestroy, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { NavigationService } from '@core/navigation/navigation.service';
import { flattenNavTargets } from '@core/navigation/nav-flatten.util';
import { routeAiCommand } from '@core/services/ai-command-router.util';
import { SpeechSession, speechRecognitionSupported, startSpeechRecognition } from '@core/services/speech-recognition.util';

interface AiLangOption { code: string; label: string; }
const AI_LANGS: AiLangOption[] = [
  { code: 'en-IN', label: 'EN' },
  { code: 'hi-IN', label: 'हिं' },
  { code: 'mr-IN', label: 'मर' }
];

/**
 * Dashboard "AI" command bar — separate from `VoiceMicButton` (which only ever fills
 * the shipment booking form). This one is a general command router: type or speak
 * something like "track SHP-000123", "check rate", "inscan order", "dispatch" and it
 * navigates to the matching page, same rule-based approach as voice booking (no LLM
 * call). Matches against the signed-in user's own permission-filtered nav tree, so it
 * only ever offers a page that user's sidebar already shows them.
 */
@Component({
  selector: 'app-ai-assistant-button',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatIconModule],
  template: `
    <div class="aib">
      <button type="button" class="aib__trigger" [class.aib__trigger--open]="open()" (click)="toggle()">
        <span class="aib__icon"><mat-icon>auto_awesome</mat-icon></span>
        <span class="aib__label">AI Assistant</span>
      </button>

      @if (open()) {
        <div class="aib__backdrop" (click)="close()"></div>
        <div class="aib__panel" (click)="$event.stopPropagation()">
          <div class="aib__head">
            <span class="aib__title">AI Assistant</span>
            <button type="button" class="aib__close" (click)="close()"><mat-icon>close</mat-icon></button>
          </div>

          <div class="aib__row">
            <input #box class="aib__input" [value]="query()" (input)="query.set(inputValue($event))"
                   (keydown.enter)="submit()" placeholder="track SHP-000123, check rate, inscan, dispatch…" />
            <button type="button" class="aib__mic" [class.aib__mic--live]="listening()"
                    [disabled]="!micSupported()" (click)="toggleMic()" aria-label="Speak a command">
              <mat-icon>{{ listening() ? 'graphic_eq' : 'mic' }}</mat-icon>
            </button>
            <button type="button" class="aib__send" [disabled]="!query().trim()" (click)="submit()">
              <mat-icon>send</mat-icon>
            </button>
          </div>

          <div class="aib__langs" role="group" aria-label="Voice language">
            @for (l of langs; track l.code) {
              <button type="button" class="aib__lang" [class.aib__lang--active]="lang() === l.code"
                      [disabled]="listening()" (click)="lang.set(l.code)">{{ l.label }}</button>
            }
          </div>

          @if (listening() && interim()) {
            <p class="aib__interim">&ldquo;{{ interim() }}&rdquo;</p>
          }
          @if (feedback(); as f) {
            <p class="aib__feedback">{{ f }}</p>
          }

          <p class="aib__hint">Try: "track &lt;AWB/LR&gt;", "check rate", "inscan order", "dispatch", "wallet balance", "book shipment"…</p>
        </div>
      }
    </div>
  `,
  styles: [`
    /* Phones: icon only, so the header's controls fit beside the logo. */
    @media (max-width: 560px) { .aib__label { display:none; } }
    .aib { position:relative; }
    .aib__trigger { position:relative; display:inline-flex; align-items:center; gap:7px; height:36px; padding:0 16px 0 12px;
      border-radius:999px; border:none; cursor:pointer; white-space:nowrap; font:700 16px var(--font-sans); color:#fff;
      background:linear-gradient(90deg,#6366f1,#a855f7,#ec4899,#6366f1); background-size:300% 100%;
      animation: aib-gradient 6s ease infinite; box-shadow:0 1px 8px rgba(147,51,234,.35); }
    .aib__trigger::before { content:''; position:absolute; inset:-2px; border-radius:999px; z-index:-1;
      background:linear-gradient(90deg,#6366f1,#a855f7,#ec4899,#6366f1); background-size:300% 100%;
      animation: aib-gradient 6s ease infinite; filter:blur(6px); opacity:.55; }
    .aib__trigger:hover, .aib__trigger--open { box-shadow:0 2px 14px rgba(147,51,234,.5); }
    @keyframes aib-gradient { 0% { background-position:0% 50%; } 50% { background-position:100% 50%; } 100% { background-position:0% 50%; } }
    .aib__icon { display:inline-flex; }
    .aib__icon mat-icon { font-size:18px; width:18px; height:18px; animation: aib-sparkle 2.2s ease-in-out infinite; }
    @keyframes aib-sparkle { 0%,100% { transform:scale(1) rotate(0deg); opacity:1; } 50% { transform:scale(1.15) rotate(8deg); opacity:.75; } }

    .aib__backdrop { position:fixed; inset:0; z-index:40; background:transparent; }
    .aib__panel { position:absolute; top:calc(100% + 10px); right:0; z-index:41; width:340px;
      background:var(--surface); border:0; border-radius:var(--r-card-lg);
      box-shadow:var(--shadow-clay-hover); padding:16px; display:flex; flex-direction:column; gap:10px; }
    .aib__head { display:flex; align-items:center; justify-content:space-between; }
    .aib__title { font:700 17px var(--font-sans); color:var(--content-fg); }
    .aib__close { border:0; background:transparent; color:var(--content-muted); cursor:pointer; display:flex; padding:2px; border-radius:6px; }
    .aib__close:hover { background:var(--surface-muted); color:var(--content-fg); }
    .aib__close mat-icon { font-size:18px; width:18px; height:18px; }

    .aib__row { display:flex; align-items:center; gap:6px; }
    .aib__input { flex:1; height:38px; padding:0 12px; background:var(--surface-muted); border:0; box-shadow:var(--shadow-clay-inset);
      border-radius:var(--r-field); font:400 16px var(--font-sans); color:var(--content-fg); min-width:0; }
    .aib__mic, .aib__send { flex:none; height:38px; width:38px; display:grid; place-items:center; border-radius:var(--r-field);
      border:0; background:var(--surface-muted); box-shadow:var(--shadow-clay-sm); color:var(--content-muted); cursor:pointer; }
    .aib__mic:hover:not(:disabled), .aib__send:hover:not(:disabled) { background:var(--surface-muted); color:var(--content-fg); }
    .aib__mic:disabled, .aib__send:disabled { opacity:.4; cursor:not-allowed; }
    .aib__mic--live { background:var(--danger); border-color:var(--danger); color:#fff; }
    .aib__mic--live mat-icon { animation: aib-pulse .9s ease-in-out infinite; }
    @keyframes aib-pulse { 0%,100% { opacity:1; transform:scale(1); } 50% { opacity:.5; transform:scale(1.2); } }
    .aib__mic mat-icon, .aib__send mat-icon { font-size:18px; width:18px; height:18px; }

    .aib__langs { display:inline-flex; gap:2px; padding:2px; border-radius:999px; background:var(--surface-muted);
      border:1px solid var(--surface-border); align-self:flex-start; }
    .aib__lang { height:24px; min-width:24px; padding:0 8px; border:0; border-radius:999px; background:transparent;
      color:var(--content-muted); font:600 14px var(--font-sans); cursor:pointer; }
    .aib__lang:hover:not(:disabled) { color:var(--content-fg); }
    .aib__lang--active { background:var(--brand-600); color:#fff; }
    .aib__lang:disabled { opacity:.5; cursor:not-allowed; }

    .aib__interim { margin:0; font:400 15px var(--font-sans); color:var(--brand-600); font-style:italic; }
    .aib__feedback { margin:0; font:500 15px var(--font-sans); color:var(--danger); background:var(--danger-bg);
      border-radius:8px; padding:8px 10px; }
    .aib__hint { margin:0; font:400 14px var(--font-sans); color:var(--content-muted); line-height:1.5; }
  `]
})
export class AiAssistantButton implements OnDestroy {
  private readonly router = inject(Router);
  private readonly nav = inject(NavigationService);

  protected readonly langs = AI_LANGS;
  protected readonly lang = signal(AI_LANGS[0].code);

  protected readonly open = signal(false);
  protected readonly query = signal('');
  protected readonly feedback = signal<string | null>(null);
  protected readonly listening = signal(false);
  protected readonly interim = signal('');
  protected readonly micSupported = signal(speechRecognitionSupported());

  private readonly targets = computed(() => flattenNavTargets(this.nav.menu()));
  private session: SpeechSession | null = null;

  protected toggle(): void {
    this.open.update((v) => !v);
    if (!this.open()) this.stopMic();
  }

  protected close(): void {
    this.open.set(false);
    this.stopMic();
  }

  protected inputValue(e: Event): string { return (e.target as HTMLInputElement).value; }

  protected toggleMic(): void {
    if (this.listening()) { this.session?.stop(); return; }
    this.interim.set('');
    const session = startSpeechRecognition(this.lang(), {
      onInterim: (text) => this.interim.set(text),
      onFinal: (text) => { this.query.set(text); this.submit(); },
      onError: (message) => { this.feedback.set(message); },
      onEnd: () => { this.listening.set(false); this.session = null; }
    });
    if (!session) return;
    this.session = session;
    this.listening.set(true);
  }

  private stopMic(): void { this.session?.stop(); }

  protected submit(): void {
    const text = this.query().trim();
    if (!text) return;

    const match = routeAiCommand(text, this.targets());
    if (!match) {
      this.feedback.set(`Couldn't match "${text}" to a page — try naming it more directly, e.g. "track", "rate", "dispatch".`);
      return;
    }

    this.feedback.set(null);
    this.query.set('');
    this.open.set(false);
    this.router.navigate([match.route], match.queryParams ? { queryParams: match.queryParams } : {});
  }

  ngOnDestroy(): void { this.session?.abort(); }
}
