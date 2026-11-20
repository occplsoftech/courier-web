import { ChangeDetectionStrategy, Component, computed, inject, input, output, signal } from '@angular/core';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { UiInput } from '@shared/components/ui-input/ui-input';
import { CompanyService } from '../company.service';
import { NotificationService } from '@core/services/notification.service';

/**
 * Branding block — logo and favicon. The backend stores each as a URL string (max 500
 * chars), so the URL is the source of truth. Picking a file shows a local preview
 * immediately, then uploads it via `CompanyService.uploadBranding` and writes the
 * returned URL into the bound control once it lands — the control's value is what
 * actually gets submitted, same as pasting a URL by hand.
 * View mode renders the marks; edit mode exposes the URL controls plus a file picker.
 */
@Component({
  selector: 'app-company-logo',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, MatIconModule, UiInput],
  template: `
    <div class="brand">
      <div class="brand__row">
        <figure class="mark mark--logo">
          @if (logoPreview()) {
            <img [src]="logoPreview()" alt="Company logo" (error)="logoBroken.set(true)" />
          } @else {
            <mat-icon>image</mat-icon>
          }
        </figure>
        <div class="brand__meta">
          <span class="brand__label">Logo</span>
          @if (editable()) {
            <app-input [control]="logoControl()" placeholder="https://…/logo.png" icon="link" [maxLength]="500" />
            <button type="button" class="brand__file" [disabled]="logoUploading()" (click)="logoFile.click()">
              <mat-icon>upload</mat-icon> {{ logoUploading() ? 'Uploading…' : 'Choose file' }}
            </button>
            <input #logoFile type="file" accept="image/*" hidden (change)="onFile($event, 'LOGO')" />
          } @else {
            <span class="brand__hint">{{ logoUrl() || 'No logo set' }}</span>
          }
        </div>
      </div>

      <div class="brand__row">
        <figure class="mark mark--fav">
          @if (faviconPreview()) {
            <img [src]="faviconPreview()" alt="Favicon" (error)="favBroken.set(true)" />
          } @else {
            <mat-icon>public</mat-icon>
          }
        </figure>
        <div class="brand__meta">
          <span class="brand__label">Favicon</span>
          @if (editable()) {
            <app-input [control]="faviconControl()" placeholder="https://…/favicon.ico" icon="link" [maxLength]="500" />
            <button type="button" class="brand__file" [disabled]="favUploading()" (click)="favFile.click()">
              <mat-icon>upload</mat-icon> {{ favUploading() ? 'Uploading…' : 'Choose file' }}
            </button>
            <input #favFile type="file" accept="image/*" hidden (change)="onFile($event, 'FAVICON')" />
          } @else {
            <span class="brand__hint">{{ faviconUrl() || 'No favicon set' }}</span>
          }
        </div>
      </div>
    </div>
  `,
  styles: [`
    .brand { display:flex; flex-direction:column; gap:20px; }
    .brand__row { display:flex; gap:16px; align-items:flex-start; }
    .brand__meta { display:flex; flex-direction:column; gap:8px; flex:1; min-width:0; }
    .brand__label { font:600 16px var(--font-sans); color:var(--content-fg); }
    .brand__hint { font:400 16px var(--font-sans); color:var(--content-muted); word-break:break-all; }
    .brand__file { display:inline-flex; align-items:center; gap:6px; align-self:flex-start;
      border:1px solid var(--surface-border); background:var(--surface); border-radius:var(--r-field);
      padding:6px 12px; font:600 15px var(--font-sans); color:var(--content-fg); cursor:pointer; }
    .brand__file mat-icon { font-size:16px; width:16px; height:16px; }
    .mark { display:grid; place-items:center; border:1px solid var(--surface-border);
      border-radius:12px; background:var(--surface-muted); overflow:hidden; flex:none; }
    .mark img { width:100%; height:100%; object-fit:contain; }
    .mark mat-icon { color:var(--content-muted); }
    .mark--logo { width:72px; height:72px; }
    .mark--fav { width:48px; height:48px; }
    .mark--fav mat-icon { font-size:20px; width:20px; height:20px; }
  `]
})
export class CompanyLogo {
  /** View-mode URLs. */
  readonly logoUrl = input<string | null | undefined>(null);
  readonly faviconUrl = input<string | null | undefined>(null);

  /** Edit-mode controls (bound to the reactive form). */
  readonly editable = input(false);
  readonly logoControl = input<FormControl>(new FormControl(''));
  readonly faviconControl = input<FormControl>(new FormControl(''));

  /** Emits once the uploaded file's real URL has been written into the control. */
  readonly filePicked = output<{ kind: 'logo' | 'favicon'; url: string }>();

  private readonly companyService = inject(CompanyService);
  private readonly notify = inject(NotificationService);

  protected readonly logoBroken = signal(false);
  protected readonly favBroken = signal(false);
  protected readonly logoUploading = signal(false);
  protected readonly favUploading = signal(false);
  private readonly logoLocal = signal<string | null>(null);
  private readonly favLocal = signal<string | null>(null);

  protected readonly logoPreview = computed(() =>
    this.logoBroken() ? null : this.logoLocal() ?? (this.editable() ? this.logoControl().value : this.logoUrl()));
  protected readonly faviconPreview = computed(() =>
    this.favBroken() ? null : this.favLocal() ?? (this.editable() ? this.faviconControl().value : this.faviconUrl()));

  onFile(event: Event, kind: 'LOGO' | 'FAVICON'): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;

    const localUrl = URL.createObjectURL(file);
    const local = kind === 'LOGO' ? this.logoLocal : this.favLocal;
    const broken = kind === 'LOGO' ? this.logoBroken : this.favBroken;
    const uploading = kind === 'LOGO' ? this.logoUploading : this.favUploading;
    local.set(localUrl);
    broken.set(false);
    uploading.set(true);

    this.companyService.uploadBranding(kind, file).subscribe({
      next: (res) => {
        uploading.set(false);
        const control = kind === 'LOGO' ? this.logoControl() : this.faviconControl();
        control.setValue(res.url);
        control.markAsDirty();
        this.filePicked.emit({ kind: kind === 'LOGO' ? 'logo' : 'favicon', url: res.url });
      },
      error: () => {
        uploading.set(false);
        local.set(null);
        this.notify.error(`The ${kind === 'LOGO' ? 'logo' : 'favicon'} could not be uploaded. Please retry.`);
      }
    });

    input.value = '';
  }
}
