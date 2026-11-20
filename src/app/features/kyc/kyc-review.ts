import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { BreadcrumbService } from '@core/services/breadcrumb.service';
import { UiCard } from '@shared/components/ui-card/ui-card';
import { apiMessage } from '@features/communication/api-error';
import { KycService } from './kyc.service';
import { KYC_STATUS_LABELS, KYC_TYPE_LABELS, KycSubjectType, KycSummary } from './kyc.models';

/** Company administrator: KYC progress of users, branches and business customers, opening each one's documents. */
@Component({
  selector: 'app-kyc-review',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DatePipe, RouterLink, UiCard],
  template: `
    <div class="page">
      <header class="page__head">
        <div>
          <h1 class="text-h1">KYC Review</h1>
          <p class="text-caption">Everyone who has started KYC. Open one to view the documents and approve or reject each.</p>
        </div>
      </header>

      <div class="tabs" role="tablist">
        @for (t of types; track t) {
          <button type="button" role="tab" [class.on]="type() === t" [attr.aria-selected]="type() === t" (click)="select(t)">{{ labels[t] }}</button>
        }
      </div>

      <app-card>
        @if (error()) {
          <p class="err" role="alert">{{ error() }}</p>
        } @else if (rows() === null) {
          <p class="muted">Loading…</p>
        } @else if (rows()!.length === 0) {
          <p class="muted">No one has started KYC yet.</p>
        } @else {
          <div class="wrap">
            <table>
              <thead><tr><th>Name</th><th>Status</th><th>To review</th><th>Approved</th><th>E-mail</th><th>Mobile</th><th>Updated</th><th></th></tr></thead>
              <tbody>
                @for (r of rows(); track r.subjectId) {
                  <tr>
                    <td><a [routerLink]="['/kyc/review', r.subjectType, r.subjectId]">{{ r.subjectName }}</a></td>
                    <td><span class="badge" [class.ok]="r.status === 'COMPLETE'" [class.info]="r.status === 'UNDER_REVIEW'" [class.warn]="r.status === 'PENDING'">{{ statusLabels[r.status] }}</span></td>
                    <td>@if (r.awaitingReview) { <strong class="todo">{{ r.awaitingReview }}</strong> } @else { — }</td>
                    <td>{{ r.requiredApproved }} / {{ r.requiredTotal }}</td>
                    <td>{{ r.emailVerified ? 'Verified' : '—' }}</td>
                    <td>{{ r.mobileVerified ? 'Verified' : '—' }}</td>
                    <td>{{ r.updatedAt | date: 'medium' }}</td>
                    <td class="end"><a [routerLink]="['/kyc/review', r.subjectType, r.subjectId]">{{ r.awaitingReview ? 'Review →' : 'View documents →' }}</a></td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        }
      </app-card>
    </div>
  `,
  styles: [`
    .tabs { display:inline-flex; gap:4px; padding:4px; border-radius:16px; background:var(--surface-muted); align-self:flex-start; flex-wrap:wrap; }
    .tabs button { border:0; background:transparent; padding:8px 18px; border-radius:12px; font:700 16px var(--font-sans); color:var(--content-muted); cursor:pointer; }
    .tabs button.on { background:var(--surface); color:var(--brand-700); box-shadow:var(--shadow-clay-sm); }
    .wrap { overflow-x:auto; }
    table { width:100%; border-collapse:collapse; font:400 17px var(--font-sans); }
    th { text-align:left; font:700 15px var(--font-sans); letter-spacing:.06em; text-transform:uppercase; color:var(--content-muted); padding:10px 14px; background:var(--surface-muted); }
    td { padding:12px 14px; border-top:1px solid var(--surface-border); white-space:nowrap; }
    .end { text-align:right; }
    a { color:var(--brand-700); font-weight:600; text-decoration:none; }
    .badge { padding:3px 10px; border-radius:999px; font:700 15px var(--font-sans); }
    .badge.ok { background:var(--success-bg); color:var(--success); } .badge.info { background:var(--info-bg); color:var(--info); }
    .todo { color:var(--warning); } .badge.warn { background:var(--warning-bg); color:var(--warning); }
    .muted { color:var(--content-muted); } .err { color:var(--danger); }
  `]
})
export class KycReview implements OnInit {
  private readonly kyc = inject(KycService);
  private readonly breadcrumb = inject(BreadcrumbService);
  protected readonly types: KycSubjectType[] = ['USER', 'BRANCH', 'CUSTOMER'];
  protected readonly labels = KYC_TYPE_LABELS;
  protected readonly statusLabels = KYC_STATUS_LABELS;
  readonly type = signal<KycSubjectType>('USER');
  readonly rows = signal<KycSummary[] | null>(null);
  readonly error = signal<string | null>(null);

  ngOnInit(): void {
    this.breadcrumb.set([{ label: 'Administration' }, { label: 'KYC Review' }]);
    this.load();
  }

  select(t: KycSubjectType): void {
    if (t === this.type()) return;
    this.type.set(t);
    this.load();
  }

  private load(): void {
    this.rows.set(null);
    this.error.set(null);
    this.kyc.list(this.type()).subscribe({
      next: (r) => this.rows.set(r),
      error: (e) => this.error.set(apiMessage(e, 'Could not load KYC.'))
    });
  }
}
