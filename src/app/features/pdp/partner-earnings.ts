import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { HttpErrorResponse } from '@angular/common/http';
import { PermissionService } from '@core/auth/permission.service';
import { AppRole } from '@core/models/role.model';
import { BreadcrumbService } from '@core/services/breadcrumb.service';
import { NotificationService } from '@core/services/notification.service';
import { Page, PageQuery, emptyPage } from '@core/models/page.model';
import { PdpEarning, PdpEarningStatus, PdpRateType } from '@core/models/pdp.model';
import { UiButton } from '@shared/components/ui-button/ui-button';
import { UiInput } from '@shared/components/ui-input/ui-input';
import { UiSelect, SelectOption } from '@shared/components/ui-select/ui-select';
import { UiTable, TableColumn } from '@shared/components/ui-table/ui-table';
import { UiPagination } from '@shared/components/ui-pagination/ui-pagination';
import { StatusBadge } from '@shared/components/status-badge/status-badge';
import { PdpBillingService } from './pdp-billing.service';
import { PdpService } from './pdp.service';

const TYPES: SelectOption[] = [{ value: 'PICKUP', label: 'Pickup' }, { value: 'DELIVERY', label: 'Delivery' }];
const STATUSES: SelectOption[] = [
  { value: 'ACCRUED', label: 'Accrued (unbilled)' }, { value: 'UNRATED', label: 'Unrated (no rate card)' },
  { value: 'BILLED', label: 'Billed' }
];

/**
 * What each partner has earned, job by job. Accrued only — nothing here is credited to a wallet;
 * the money is settled from a Partner Billing statement. An UNRATED row had no live rate card
 * when it was earned (amount 0): add the card, then Re-price it.
 */
@Component({
  selector: 'app-partner-earnings',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, UiButton, UiInput, UiSelect, UiTable, UiPagination, StatusBadge],
  template: `
    <div class="page">
      <header class="page__head">
        <div><h1 class="text-h1">Partner Earnings</h1>
          <p class="text-caption">Pickup and delivery earnings per job — accrued, settled through Partner Billing.</p></div>
      </header>
      <div class="filters">
        @if (isAdmin()) { <app-select [control]="partnerCtl" label="Partner" [options]="partnerOpts()" [allowEmpty]="true" emptyLabel="All partners" placeholder="All partners" /> }
        <app-select [control]="typeCtl" label="Type" [options]="types" [allowEmpty]="true" emptyLabel="All" placeholder="All" />
        <app-select [control]="statusCtl" label="Status" [options]="statuses" [allowEmpty]="true" emptyLabel="All" placeholder="All" />
        <app-input [control]="fromCtl" label="From" type="date" />
        <app-input [control]="toCtl" label="To" type="date" />
      </div>
      <div class="sum">Showing {{ page().content.length }} of {{ page().totalElements }} · page total <strong>{{ pageTotal() }}</strong></div>
      <app-table [columns]="columns" [rows]="page().content" [loading]="loading()" [startIndex]="page().page * page().size"
                 emptyTitle="No earnings yet" emptyHint="Earnings appear when a pickup is booked or a partner delivery's POD is approved." idKey="id">
        <ng-template #row let-e>
          <td>{{ e.earnedOn }}</td>
          <td><strong>{{ e.branchName }}</strong><div class="text-caption">{{ e.branchCode }}</div></td>
          <td>{{ e.earningType === 'PICKUP' ? 'Pickup' : 'Delivery' }}<div class="text-caption">{{ e.referenceNo }}</div></td>
          <td>{{ e.chargeableWeightKg ?? e.actualWeightKg ?? '—' }} kg<div class="text-caption">{{ e.pincode || '' }}</div></td>
          <td>{{ e.ratePerKg ?? '—' }}</td>
          <td><strong>{{ e.totalAmount }}</strong>
            @if (e.mathadiCharge || e.odaCharge) { <div class="text-caption">incl. {{ e.mathadiCharge + e.odaCharge }} extras</div> }</td>
          <td><app-status-badge [value]="e.status" [label]="label(e.status)" />
            @if (e.status === 'UNRATED') { <div class="text-caption warn">{{ e.remark }}</div> }</td>
          <td class="col-actions">
            @if (e.status === 'UNRATED' && isAdmin()) { <app-button variant="stroked" icon="calculate" (pressed)="reprice(e)">Re-price</app-button> }
          </td>
        </ng-template>
      </app-table>
      <app-pagination [page]="page()" (pageChange)="onPage($event)" />
    </div>
  `,
  styles: [`
    .filters { display:grid; grid-template-columns:repeat(5,minmax(0,1fr)); gap:16px; margin:0 0 12px; align-items:end; }
    .sum { font:400 16px var(--font-sans); color:var(--content-muted); margin:0 0 12px; } .sum strong { color:var(--content-fg); }
    .warn { color:var(--danger); } .col-actions { text-align:right; width:120px; }
    @media (max-width:980px){ .filters { grid-template-columns:1fr 1fr; } }
  `]
})
export class PartnerEarnings implements OnInit {
  private readonly svc = inject(PdpBillingService);
  private readonly pdp = inject(PdpService);
  private readonly breadcrumb = inject(BreadcrumbService);
  private readonly notify = inject(NotificationService);
  private readonly perms = inject(PermissionService);
  protected readonly isAdmin = computed(() => this.perms.hasRole(AppRole.COMPANY_ADMIN));

  protected readonly partnerCtl = new FormControl<string>('', { nonNullable: true });
  protected readonly typeCtl = new FormControl<string>('', { nonNullable: true });
  protected readonly statusCtl = new FormControl<string>('', { nonNullable: true });
  protected readonly fromCtl = new FormControl<string>('', { nonNullable: true });
  protected readonly toCtl = new FormControl<string>('', { nonNullable: true });
  protected readonly partnerOpts = signal<SelectOption[]>([]);
  protected readonly page = signal<Page<PdpEarning>>(emptyPage());
  protected readonly loading = signal(true);
  protected readonly types = TYPES;
  protected readonly statuses = STATUSES;
  private query: PageQuery = { page: 0, size: 20 };

  protected readonly columns: TableColumn<PdpEarning>[] = [
    { key: 'date', header: 'Date' }, { key: 'partner', header: 'Partner' }, { key: 'job', header: 'Job' },
    { key: 'weight', header: 'Weight' }, { key: 'rate', header: 'Rate / kg' }, { key: 'amount', header: 'Amount' },
    { key: 'status', header: 'Status', width: '150px' }, { key: 'actions', header: '', width: '120px', align: 'right' }
  ];

  ngOnInit(): void {
    this.breadcrumb.set([{ label: 'Pickup Delivery Partner Management' }, { label: 'Partner Earnings' }]);
    if (this.isAdmin()) {
      this.pdp.partners({ page: 0, size: 200 }).subscribe((r) =>
        this.partnerOpts.set(r.content.map((b) => ({ value: b.id, label: `${b.branchName} (${b.branchCode})` }))));
    }
    [this.partnerCtl, this.typeCtl, this.statusCtl, this.fromCtl, this.toCtl].forEach((c) =>
      c.valueChanges.subscribe(() => { this.query = { ...this.query, page: 0 }; this.load(); }));
    this.load();
  }

  protected label(s: PdpEarningStatus): string { return { ACCRUED: 'Accrued', UNRATED: 'Unrated', BILLED: 'Billed', REVERSED: 'Reversed' }[s]; }
  protected pageTotal(): number { return Math.round(this.page().content.reduce((a, e) => a + e.totalAmount, 0) * 100) / 100; }

  private load(): void {
    this.loading.set(true);
    this.svc.earnings({
      ...this.query, branchId: this.partnerCtl.value || undefined, type: (this.typeCtl.value || undefined) as PdpRateType | undefined,
      status: (this.statusCtl.value || undefined) as PdpEarningStatus | undefined,
      from: this.fromCtl.value || undefined, to: this.toCtl.value || undefined
    }).subscribe({
      next: (p) => { this.page.set(p); this.loading.set(false); },
      error: () => this.loading.set(false)
    });
  }

  protected onPage(i: number): void { this.query = { ...this.query, page: i }; this.load(); }

  protected reprice(e: PdpEarning): void {
    this.svc.reprice(e.id).subscribe({
      next: () => { this.notify.success('Earning re-priced.'); this.load(); },
      error: (err: HttpErrorResponse) => this.notify.error(err.error?.message ?? 'Could not re-price.')
    });
  }
}
