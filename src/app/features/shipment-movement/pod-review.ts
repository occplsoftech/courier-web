import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { FormBuilder, FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { BreadcrumbService } from '@core/services/breadcrumb.service';
import { NotificationService } from '@core/services/notification.service';
import { AuthService } from '@core/auth/auth.service';
import { PodService } from '@core/services/pod.service';
import { DeliveredShipmentPod } from '@core/models/pod.model';
import { Page, PageQuery, emptyPage } from '@core/models/page.model';
import { DialogService } from '@shared/components/ui-dialog/dialog.service';
import { UiCard } from '@shared/components/ui-card/ui-card';
import { UiButton } from '@shared/components/ui-button/ui-button';
import { UiInput } from '@shared/components/ui-input/ui-input';
import { UiLoader } from '@shared/components/ui-loader/ui-loader';
import { UiSearch } from '@shared/components/ui-search/ui-search';
import { UiPagination } from '@shared/components/ui-pagination/ui-pagination';
import { PinIllustration } from '@shared/components/illustrations/pin-illustration';
import { MasterDataService } from '@features/masters/master-data.service';
import { SelectOption } from '@shared/components/ui-select/ui-select';

/** POD Review — every delivered shipment, whether or not POD Auto Verification ever ran
 *  against it, with a click-to-enlarge preview of the captured photo/signature. A row whose
 *  latest verification is PENDING gets the Approve/Reject decision form (PodService.review);
 *  every other row (PASS, FAIL, or no POD at all) is view-only. AI itself never decides a
 *  PASS/FAIL outcome — a human always does, which is why every delivery-app upload starts
 *  PENDING. See MEMORY/modules/pod-verification.md. */
@Component({
  selector: 'app-pod-review',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, DatePipe, MatIconModule, UiCard, UiLoader, UiButton, UiInput, UiSearch,
    UiPagination, PinIllustration],
  template: `
    <div class="page">
      <header class="page__head" data-tour="pod-review-head">
        <div class="page__head-row">
          <app-pin-illustration class="page__head-ill" [size]="52" />
          <div><h1 class="text-h1">POD Review</h1>
          <p class="text-caption">Every delivered order and its captured proof of delivery — PENDING ones need a decision.</p></div>
        </div>
        @if (!selected()) {
          <div class="page__actions">
            <app-search placeholder="Search tracking no. or shipment no…" (changed)="onSearch($event)" />
            <app-button variant="stroked" icon="refresh" (pressed)="load()">Refresh</app-button>
          </div>
        }
      </header>

      @if (!selected()) {
        @if (loading()) {
          <app-loader [minHeight]="120" caption="Loading…" />
        } @else if (!page().content.length) {
          <app-card><p class="empty">No delivered orders yet.</p></app-card>
        } @else {
          <app-card>
            <div class="tbl__wrap">
              <table class="tbl">
                <thead>
                  <tr><th>#</th><th>Shipment No.</th><th>Receiver</th><th>From</th><th>To</th><th>Received</th><th>Delivered</th><th>POD</th><th>AI Status</th><th>Score</th><th></th></tr>
                </thead>
                <tbody>
                  @for (row of page().content; track row.shipmentId; let i = $index) {
                    <tr class="tbl__row--actionable" (click)="select(row)">
                      <td>{{ page().page * page().size + i + 1 }}</td>
                      <td>{{ row.shipmentNumber }}</td>
                      <td>{{ row.receiverName || '—' }}</td>
                      <td>{{ branchLabel(row.bookingBranchId) }}</td>
                      <td>{{ branchLabel(row.deliveryBranchId) }}</td>
                      <td>{{ row.receivedAt ? (row.receivedAt | date: 'mediumDate') : '—' }}</td>
                      <td>{{ row.deliveredAt ? (row.deliveredAt | date: 'mediumDate') : '—' }}</td>
                      <td>
                        @if (row.photoUrl) {
                          <button class="pod-thumb--sm" type="button" (click)="preview($event, row.photoUrl, row)">
                            <img [src]="row.photoUrl" alt="POD photo" />
                          </button>
                        } @else {
                          <span class="text-caption">No photo</span>
                        }
                      </td>
                      <td><span class="status-badge" [class]="'status-badge--' + (row.verificationStatus || 'none')">
                        {{ row.verificationStatus || '—' }}
                      </span></td>
                      <td>{{ row.verificationScore != null ? row.verificationScore + '/100' : '—' }}</td>
                      <td class="tbl--right"><app-button variant="stroked" icon="visibility" (pressed)="select(row)">View</app-button></td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
            <app-pagination [page]="page()" (pageChange)="onPage($event)" />
          </app-card>
        }
      }

      @if (selected(); as row) {
        <app-card>
          <div class="sh">
            <div><strong>{{ row.shipmentNumber }}</strong>
              <span class="text-caption">
                @if (row.verificationScore != null) { Score {{ row.verificationScore }}/100 · }
                {{ row.verificationStatus || 'No POD verification' }}
              </span></div>
            <app-button variant="stroked" icon="close" (pressed)="selected.set(null)">Back to List</app-button>
          </div>
          <dl class="ai-result__grid sh__meta">
            <div><dt>From</dt><dd>{{ branchLabel(row.bookingBranchId) }}</dd></div>
            <div><dt>To</dt><dd>{{ branchLabel(row.deliveryBranchId) }}</dd></div>
            <div><dt>Received</dt><dd>{{ row.receivedAt ? (row.receivedAt | date: 'medium') : '—' }}</dd></div>
            <div><dt>Delivered</dt><dd>{{ row.deliveredAt ? (row.deliveredAt | date: 'medium') : '—' }}</dd></div>
          </dl>
        </app-card>

        <app-card title="Captured POD">
          <div class="pods">
            @if (row.photoUrl) {
              <button class="pod-thumb" type="button" (click)="preview($event, row.photoUrl, row)">
                <img [src]="row.photoUrl" alt="Delivery photo" />
                <span>Photo</span>
              </button>
            } @else {
              <div class="pod-thumb pod-thumb--empty"><mat-icon>image_not_supported</mat-icon><span>No photo</span></div>
            }
            @if (row.signatureUrl) {
              <button class="pod-thumb" type="button" (click)="preview($event, row.signatureUrl, row)">
                <img [src]="row.signatureUrl" alt="Signature" />
                <span>Signature</span>
              </button>
            } @else {
              <div class="pod-thumb pod-thumb--empty"><mat-icon>draw</mat-icon><span>No signature</span></div>
            }
          </div>
        </app-card>

        @if (row.verificationStatus) {
          <app-card title="AI Result">
            <dl class="ai-result__grid">
              <div><dt>AI Provider</dt><dd>{{ row.aiProvider || '—' }} / {{ row.aiModel || '—' }}</dd></div>
            </dl>
            @if (row.verificationReasons?.length) {
              <ul class="ai-result__reasons">
                @for (r of row.verificationReasons; track r) { <li>{{ r }}</li> }
              </ul>
            }
          </app-card>
        }

        @if (row.verificationStatus === 'PENDING') {
          @if (canDecide()) {
            <app-card title="Decision">
              <form [formGroup]="form" class="df">
                <app-input [control]="c('remarks')" label="Remarks" placeholder="Optional" [maxLength]="1000" />
                <div class="df__bar">
                  <app-button variant="danger" icon="cancel" [loading]="deciding() === 'reject'" (pressed)="decide(false)">Reject</app-button>
                  <app-button icon="check_circle" [loading]="deciding() === 'approve'" (pressed)="decide(true)">Approve</app-button>
                </div>
              </form>
            </app-card>
          } @else {
            <app-card title="Decision">
              <p class="text-caption">Awaiting a company-level decision — approve/reject is a COMPANY_ADMIN action.</p>
            </app-card>
          }
        }
      }
    </div>
  `,
  styles: [`
    .page__head { display:flex; justify-content:space-between; align-items:flex-start; gap:16px; flex-wrap:wrap; }
    .page__actions { display:flex; align-items:center; gap:10px; }
    .empty { font:400 17px var(--font-sans); color:var(--content-muted); text-align:center; padding:20px; }
    .tbl__wrap { overflow-x:auto; border:1px solid var(--surface-border); border-radius:var(--r-field); }
    .tbl { width:100%; border-collapse:collapse; font:400 16px var(--font-sans); }
    .tbl th { text-align:left; padding:10px 14px; background:var(--surface-muted); color:var(--content-muted); font:600 14px var(--font-sans); text-transform:uppercase; letter-spacing:.03em; white-space:nowrap; }
    .tbl td { padding:10px 14px; border-top:1px solid var(--surface-border); white-space:nowrap; }
    .tbl--right { text-align:right; }
    .tbl__row--actionable { cursor:pointer; }
    .tbl__row--actionable:hover { background:var(--surface-muted); }
    .pod-thumb--sm { border:0; background:none; padding:0; cursor:pointer; width:40px; height:40px; border-radius:8px; overflow:hidden; }
    .pod-thumb--sm img { width:100%; height:100%; object-fit:cover; display:block; }
    .status-badge { display:inline-block; padding:2px 10px; border-radius:999px; font:600 14px var(--font-sans); text-transform:uppercase; letter-spacing:.03em; }
    .status-badge--PASS { background:var(--success-bg, #e6f6ec); color:var(--success, #1a7f4a); }
    .status-badge--PENDING { background:var(--warning-bg, #fff4e0); color:var(--warning, #a15c00); }
    .status-badge--FAIL { background:var(--danger-bg); color:var(--danger); }
    .status-badge--none { background:var(--surface-muted); color:var(--content-muted); }
    .sh { display:flex; justify-content:space-between; align-items:center; gap:12px; }
    .sh strong { display:block; font:600 18px var(--font-sans); }
    .sh__meta { margin-top:14px; }
    .pods { display:flex; gap:16px; flex-wrap:wrap; }
    .pod-thumb { display:flex; flex-direction:column; align-items:center; gap:6px; width:160px;
      border:1px solid var(--surface-border); border-radius:var(--r-field); padding:10px; cursor:pointer;
      background:none; text-decoration:none; color:var(--content-fg); font:600 15px var(--font-sans); }
    .pod-thumb img { width:100%; height:140px; object-fit:cover; border-radius:calc(var(--r-field) - 4px); }
    .pod-thumb--empty { color:var(--content-muted); height:170px; justify-content:center; }
    .ai-result__grid { display:grid; grid-template-columns:repeat(auto-fit, minmax(160px, 1fr)); gap:10px 16px; margin:0; }
    .ai-result__grid dt { font:600 14px var(--font-sans); color:var(--content-muted); text-transform:uppercase; letter-spacing:.03em; }
    .ai-result__grid dd { margin:2px 0 0; font:500 16px var(--font-sans); }
    .ai-result__reasons { margin:12px 0 0; padding-left:18px; font:400 16px var(--font-sans); color:var(--content-muted); }
    .df { display:flex; flex-direction:column; gap:16px; }
    .df__bar { display:flex; justify-content:flex-end; gap:10px; }
  `]
})
export class PodReview implements OnInit {
  private readonly fb = inject(FormBuilder);
  private readonly breadcrumb = inject(BreadcrumbService);
  private readonly notify = inject(NotificationService);
  private readonly auth = inject(AuthService);
  private readonly podService = inject(PodService);
  private readonly dialog = inject(DialogService);
  private readonly masters = inject(MasterDataService);

  readonly branchOptions = signal<SelectOption[]>([]);

  /** Approve/reject credits delivery commission, so it's company-level now (backend
   *  enforces the real gate — hasRole('COMPANY_ADMIN') on PodVerificationServiceImpl
   *  .review — this just avoids showing a form that would 403). */
  readonly canDecide = () => this.auth.hasAnyRole(['COMPANY_ADMIN']);

  /** A branch-tier viewer sees only their own branch's deliveries, same scoping rule the
   *  Delivery worklist and Shipment list already apply. */
  private readonly myBranchId = this.auth.user()?.branchId ?? null;

  readonly page = signal<Page<DeliveredShipmentPod>>(emptyPage<DeliveredShipmentPod>());
  readonly loading = signal(true);
  readonly selected = signal<DeliveredShipmentPod | null>(null);
  readonly deciding = signal<'approve' | 'reject' | null>(null);

  private query: PageQuery = {
    page: 0, size: 20, sort: 'createdDate,desc',
    ...(this.myBranchId ? { deliveryBranchId: this.myBranchId } : {})
  };

  readonly form: FormGroup = this.fb.group({
    remarks: ['', Validators.maxLength(1000)]
  });

  ngOnInit(): void {
    this.breadcrumb.set([{ label: 'Operations' }, { label: 'POD Review' }]);
    this.masters.options('branches').subscribe((o) => this.branchOptions.set(o));
    this.load();
  }

  protected c(name: string): FormControl { return this.form.get(name) as FormControl; }

  branchLabel(id: string | null): string {
    return this.branchOptions().find((o) => o.value === id)?.label ?? '—';
  }

  load(): void {
    this.loading.set(true);
    this.podService.deliveredWithPod(this.query).subscribe({
      next: (p) => { this.page.set(p); this.loading.set(false); },
      error: () => { this.loading.set(false); }
    });
  }

  onSearch(t: string): void {
    this.query = { ...this.query, search: t || undefined, page: 0 };
    this.load();
  }

  onPage(i: number): void {
    this.query = { ...this.query, page: i };
    this.load();
  }

  preview(event: Event, url: string | null, row: DeliveredShipmentPod): void {
    event.stopPropagation();
    if (url) this.dialog.previewImage(url, row.shipmentNumber);
  }

  select(row: DeliveredShipmentPod): void {
    this.selected.set(row);
    this.form.reset();
  }

  decide(approve: boolean): void {
    const row = this.selected();
    if (!row) return;
    this.deciding.set(approve ? 'approve' : 'reject');
    this.podService.review(row.shipmentId, {
      approve, remarks: this.c('remarks').value?.trim() || null
    }).subscribe({
      next: () => {
        this.deciding.set(null);
        this.notify.success(approve ? 'POD approved.' : 'POD rejected.');
        this.selected.set(null);
        this.load();
      },
      error: (e: HttpErrorResponse) => {
        this.deciding.set(null);
        this.notify.error(e.error?.message ?? 'Could not record the decision.');
      }
    });
  }
}
