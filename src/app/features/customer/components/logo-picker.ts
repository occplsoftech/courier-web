import { ChangeDetectionStrategy, Component, input, output, signal } from '@angular/core';
import { UiButton } from '@shared/components/ui-button/ui-button';

export const MAX_LOGO_BYTES = 150 * 1024;
const TYPES = ['image/png', 'image/jpeg', 'image/webp'];

/**
 * Picks a brand logo: shows the current one (a data URL) or the file just chosen, and reports the choice. `picked` emits
 * the chosen File, or null when the logo is removed; nothing is uploaded here — the page does that after it saves.
 */
@Component({
  selector: 'app-logo-picker',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [UiButton],
  template: `
    <div class="lp">
      <span class="lp__box">
        @if (preview() ?? current()) { <img [src]="(preview() ?? current())!" alt="Logo preview" /> }
        @else { <span class="lp__none" aria-hidden="true">Logo</span> }
      </span>
      <div class="lp__text">
        <strong>{{ label() }}</strong>
        <span class="lp__hint">PNG, JPEG or WebP, up to 150 KB.</span>
        @if (error()) { <span class="lp__error" role="alert">{{ error() }}</span> }
        <div class="lp__actions">
          <app-button type="button" variant="stroked" icon="upload" (pressed)="picker.click()">
            {{ (preview() ?? current()) ? 'Replace logo' : 'Upload logo' }}
          </app-button>
          @if (preview() ?? current()) { <app-button type="button" variant="stroked" (pressed)="remove()">Remove</app-button> }
          <input #picker type="file" hidden accept="image/png,image/jpeg,image/webp" (change)="choose($event)"
                 [attr.aria-label]="label()" />
        </div>
      </div>
    </div>
  `,
  styles: [`
    .lp { display:flex; gap:16px; align-items:center; }
    .lp__box { display:grid; place-items:center; flex:none; width:84px; height:84px; border-radius:14px; background:#fff; border:1px solid var(--surface-border); overflow:hidden; }
    .lp__box img { max-width:85%; max-height:85%; object-fit:contain; }
    .lp__none { font:600 16px var(--font-sans); color:var(--content-muted); }
    .lp__text { display:flex; flex-direction:column; gap:4px; min-width:0; }
    .lp__hint { font:400 15px var(--font-sans); color:var(--content-muted); }
    .lp__error { font:500 15px var(--font-sans); color:var(--danger); }
    .lp__actions { display:flex; gap:8px; flex-wrap:wrap; margin-top:4px; }
  `]
})
export class LogoPicker {
  readonly label = input('Brand logo');
  /** The logo already saved (a data URL), if any. */
  readonly current = input<string | null>(null);
  readonly picked = output<File | null>();

  protected readonly preview = signal<string | null | undefined>(undefined);
  protected readonly error = signal<string | null>(null);

  protected choose(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    if (!TYPES.includes(file.type)) { this.error.set('The logo must be a PNG, JPEG or WebP image.'); return; }
    if (file.size > MAX_LOGO_BYTES) { this.error.set('The logo is larger than 150 KB. Use a smaller image.'); return; }
    this.error.set(null);
    const reader = new FileReader();
    reader.onload = () => { this.preview.set(String(reader.result)); this.picked.emit(file); };
    reader.readAsDataURL(file);
  }

  protected remove(): void {
    this.error.set(null);
    this.preview.set(null);
    this.picked.emit(null);
  }
}
