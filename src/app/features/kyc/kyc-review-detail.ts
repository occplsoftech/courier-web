import { ChangeDetectionStrategy, Component, OnInit, inject, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { BreadcrumbService } from '@core/services/breadcrumb.service';
import { NotificationService } from '@core/services/notification.service';
import { UiCard } from '@shared/components/ui-card/ui-card';
import { UiLoader } from '@shared/components/ui-loader/ui-loader';
import { DialogService } from '@shared/components/ui-dialog/dialog.service';
import { apiMessage } from '@features/communication/api-error';
import { KycChecklist } from './kyc-checklist';
import { KycService, openBlob } from './kyc.service';
import { KYC_TYPE_LABELS, KycSlot, KycSubjectType, KycView } from './kyc.models';

/** Company administrator: one user's, branch's or business customer's KYC — view, download, approve or reject each document. */
@Component({
  selector: 'app-kyc-review-detail',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, UiCard, UiLoader, KycChecklist],
  template: `
    <div class="page">
      <a class="back" routerLink="/kyc/review">← KYC Review</a>
      <app-card>
        @if (error()) {
          <p class="err" role="alert">{{ error() }}</p>
        } @else if (view(); as v) {
          <app-kyc-checklist [view]="v" [readOnly]="true" [reviewable]="true" [busy]="busy()"
                             (open)="open($event.slot, $event.download)" (approve)="approve($event)"
                             (reject)="reject($event.slot.label, $event.documentId)" />
        } @else {
          <app-loader [minHeight]="220" caption="Loading…" />
        }
      </app-card>
    </div>
  `,
  styles: [`.back { font:600 17px var(--font-sans); color:var(--brand-700); text-decoration:none; } .err { color:var(--danger); }`]
})
export class KycReviewDetail implements OnInit {
  readonly type = input.required<KycSubjectType>();
  readonly id = input.required<string>();
  private readonly kyc = inject(KycService);
  private readonly notify = inject(NotificationService);
  private readonly breadcrumb = inject(BreadcrumbService);
  readonly view = signal<KycView | null>(null);
  readonly error = signal<string | null>(null);
  readonly busy = signal<string | null>(null);
  private readonly dialogs = inject(DialogService);

  ngOnInit(): void {
    this.kyc.subject(this.type(), this.id()).subscribe({
      next: (v) => {
        this.view.set(v);
        this.breadcrumb.set([{ label: 'Administration' }, { label: 'KYC Review', route: '/kyc/review' },
          { label: KYC_TYPE_LABELS[v.subjectType] }, { label: v.subjectName }]);
      },
      error: (e) => this.error.set(apiMessage(e, 'Could not load this KYC.'))
    });
  }

  approve(documentId: string): void {
    this.busy.set(documentId + ':approve');
    this.kyc.approve(this.type(), this.id(), documentId).subscribe({
      next: (v) => { this.busy.set(null); this.view.set(v); this.notify.success(v.status === 'COMPLETE' ? 'Approved. KYC is now complete.' : 'Document approved.'); },
      error: (e) => { this.busy.set(null); this.notify.error(apiMessage(e, 'Could not approve the document.')); }
    });
  }

  reject(label: string, documentId: string): void {
    this.dialogs.prompt({
      title: `Reject ${label}?`, message: 'Tell the uploader what is wrong. They will see this and upload a new file.',
      label: 'Reason', placeholder: 'e.g. The photo is blurred; the name is not readable', confirmLabel: 'Reject', danger: true, maxLength: 500
    }).subscribe((reason) => {
      if (!reason) return;
      this.busy.set(documentId + ':reject');
      this.kyc.reject(this.type(), this.id(), documentId, reason).subscribe({
        next: (v) => { this.busy.set(null); this.view.set(v); this.notify.success('Document rejected. The uploader will see your reason.'); },
        error: (e) => { this.busy.set(null); this.notify.error(apiMessage(e, 'Could not reject the document.')); }
      });
    });
  }

  open(slot: KycSlot, download: boolean): void {
    const u = slot.uploaded;
    if (!u) return;
    this.kyc.subjectFile(this.type(), this.id(), u.id).subscribe({
      next: (b) => openBlob(b, u.fileName, download),
      error: (e) => this.notify.error(apiMessage(e, 'Could not open the document.'))
    });
  }
}
