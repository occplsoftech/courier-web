import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { BreadcrumbService } from '@core/services/breadcrumb.service';
import { NotificationService } from '@core/services/notification.service';
import { AuthService } from '@core/auth/auth.service';
import { DialogService } from '@shared/components/ui-dialog/dialog.service';
import { UiCard } from '@shared/components/ui-card/ui-card';
import { UiLoader } from '@shared/components/ui-loader/ui-loader';
import { apiMessage } from '@features/communication/api-error';
import { KycChecklist } from './kyc-checklist';
import { KycService, openBlob } from './kyc.service';
import { KycChannel, KycScope, KycSlot, KycView } from './kyc.models';

/** The signed-in user's own KYC, and — for a branch manager — their branch's. */
@Component({
  selector: 'app-my-kyc',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [UiCard, UiLoader, KycChecklist],
  template: `
    <div class="page">
      <header class="page__head">
        <div>
          <h1 class="text-h1">KYC</h1>
          <p class="text-caption">Upload your documents and verify your e-mail and mobile. KYC is complete as soon as everything is done.</p>
        </div>
      </header>

      @if (isBranchManager()) {
        <div class="tabs" role="tablist">
          <button type="button" role="tab" [class.on]="scope() === 'me'" [attr.aria-selected]="scope() === 'me'" (click)="switchTo('me')">My KYC</button>
          <button type="button" role="tab" [class.on]="scope() === 'branch'" [attr.aria-selected]="scope() === 'branch'" (click)="switchTo('branch')">Branch KYC</button>
        </div>
      }

      <app-card>
        @if (error()) {
          <p class="err" role="alert">{{ error() }}</p>
        } @else if (view(); as v) {
          <app-kyc-checklist [view]="v" [busy]="busy()" (upload)="upload($event.slot, $event.file)" (remove)="remove($event)"
                             (send)="send($event)" (verify)="verify($event.channel, $event.code)" (open)="open($event.slot, $event.download)" />
        } @else {
          <app-loader [minHeight]="220" caption="Loading…" />
        }
      </app-card>
    </div>
  `,
  styles: [`
    .tabs { display:inline-flex; gap:4px; padding:4px; border-radius:16px; background:var(--surface-muted); align-self:flex-start; }
    .tabs button { border:0; background:transparent; padding:8px 18px; border-radius:12px; font:700 16px var(--font-sans); color:var(--content-muted); cursor:pointer; }
    .tabs button.on { background:var(--surface); color:var(--brand-700); box-shadow:var(--shadow-clay-sm); }
    .err { color:var(--danger); font:500 17px var(--font-sans); }
  `]
})
export class MyKyc implements OnInit {
  private readonly kyc = inject(KycService);
  private readonly notify = inject(NotificationService);
  private readonly dialogs = inject(DialogService);
  private readonly auth = inject(AuthService);
  private readonly breadcrumb = inject(BreadcrumbService);

  readonly scope = signal<KycScope>('me');
  readonly view = signal<KycView | null>(null);
  readonly error = signal<string | null>(null);
  readonly busy = signal<string | null>(null);
  readonly isBranchManager = computed(() => this.auth.roles().includes('BRANCH_MANAGER'));

  ngOnInit(): void {
    this.breadcrumb.set([{ label: 'KYC' }]);
    this.load();
  }

  switchTo(scope: KycScope): void {
    if (scope === this.scope()) return;
    this.scope.set(scope);
    this.load();
  }

  private load(): void {
    this.view.set(null);
    this.error.set(null);
    this.kyc.view(this.scope()).subscribe({
      next: (v) => this.view.set(v),
      error: (e) => this.error.set(apiMessage(e, 'Could not load the KYC.'))
    });
  }

  private run(key: string, call: ReturnType<KycService['view']>, done?: string): void {
    this.busy.set(key);
    call.subscribe({
      next: (v) => { this.busy.set(null); this.view.set(v); if (done) this.notify.success(done); },
      error: (e) => { this.busy.set(null); this.notify.error(apiMessage(e, 'That did not work. Please try again.')); }
    });
  }

  upload(slot: KycSlot, file: File): void { this.run(slot.code, this.kyc.upload(this.scope(), slot.code, file), `${slot.label} uploaded.`); }
  send(channel: KycChannel): void {
    this.run(channel + ':send', this.kyc.sendCode(this.scope(), channel), channel === 'email' ? 'Code sent to your e-mail.' : 'Code sent to your mobile.');
  }
  verify(channel: KycChannel, code: string): void {
    this.run(channel + ':verify', this.kyc.verify(this.scope(), channel, code), channel === 'email' ? 'E-mail verified.' : 'Mobile verified.');
  }

  remove(documentId: string): void {
    this.dialogs.confirm({ title: 'Remove this document?', message: 'You can upload it again at any time.', confirmLabel: 'Remove', danger: true })
      .subscribe((ok) => { if (ok) this.run('remove', this.kyc.remove(this.scope(), documentId), 'Document removed.'); });
  }

  open(slot: KycSlot, download: boolean): void {
    const u = slot.uploaded;
    if (!u) return;
    this.kyc.file(this.scope(), u.id).subscribe({
      next: (b) => openBlob(b, u.fileName, download),
      error: (e) => this.notify.error(apiMessage(e, 'Could not open the document.'))
    });
  }
}
