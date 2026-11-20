import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { BreadcrumbService } from '@core/services/breadcrumb.service';
import { NotificationService } from '@core/services/notification.service';
import { AuthService } from '@core/auth/auth.service';
import { Page, PageQuery, emptyPage } from '@core/models/page.model';
import { UiTable, TableColumn, SortState } from '@shared/components/ui-table/ui-table';
import { UiPagination } from '@shared/components/ui-pagination/ui-pagination';
import { UiCard } from '@shared/components/ui-card/ui-card';
import { UiButton } from '@shared/components/ui-button/ui-button';
import { UiInput } from '@shared/components/ui-input/ui-input';
import { UiSelect, SelectOption } from '@shared/components/ui-select/ui-select';
import { StatusBadge } from '@shared/components/status-badge/status-badge';
import { ShipmentService } from '@features/shipment/shipment.service';
import { HubOperationsService } from './hub-operations.service';
import { HUB_EXCEPTION_TYPES, HubException } from './hub-operations.model';

const TYPE_OPTIONS: SelectOption[] = HUB_EXCEPTION_TYPES.map((t) => ({ value: t, label: t.replace('_', ' ') }));

/**
 * Exceptions — Missing / Damaged / Short / Wrong Destination / Misrouted / On Hold.
 * Raising one never marks the shipment delivered or changes its status; it is its own
 * incident record (`ShipmentException`), resolved explicitly by a human. See
 * `HubOperationsService.raiseException`/`resolveException`.
 */
@Component({
  selector: 'app-hub-exceptions',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, DatePipe, UiTable, UiPagination, UiCard, UiButton, UiInput, UiSelect, StatusBadge],
  template: `
    <div class="page">
      <header class="page__head">
        <div><h1 class="text-h1">Exceptions</h1><p class="text-caption">{{ page().totalElements }} exception(s) at your hub.</p></div>
        <app-button variant="stroked" icon="refresh" (pressed)="load()">Refresh</app-button>
      </header>

      <app-card title="Raise Exception">
        <form class="row" [formGroup]="raiseForm" (ngSubmit)="raise()">
          <app-input [control]="c('trackingNumber')" label="AWB / Tracking Number" placeholder="Scan or type…" />
          <app-select [control]="c('exceptionType')" label="Type" [options]="typeOptions" placeholder="Select type…" />
          <app-input [control]="c('remarks')" label="Remarks" placeholder="Optional" />
          <app-button type="submit" icon="report_problem" [loading]="raising()">Raise</app-button>
        </form>
      </app-card>

      <app-table [columns]="columns" [rows]="page().content" [loading]="loading()" [sort]="sort()"
                 [startIndex]="page().page * page().size"
                 emptyTitle="No exceptions" emptyHint="Nothing raised at your hub." (sortChange)="onSort($event)" idKey="id">
        <ng-template #row let-e>
          <td>{{ e.exceptionType.replace('_', ' ') }}</td>
          <td class="mono">{{ e.shipmentId }}</td>
          <td><app-status-badge [value]="e.status" /></td>
          <td>{{ e.remarks || '—' }}</td>
          <td>{{ e.raisedAt | date: 'dd MMM, HH:mm' }}</td>
          <td>
            @if (e.status === 'OPEN') {
              <app-button variant="stroked" [loading]="resolvingId() === e.id" (pressed)="resolve(e)">Resolve</app-button>
            } @else {
              <span class="text-caption">{{ e.resolutionRemarks || 'Resolved' }}</span>
            }
          </td>
        </ng-template>
      </app-table>
      <app-pagination [page]="page()" (pageChange)="onPage($event)" />
    </div>
  `,
  styles: [`
    .page__head { display:flex; justify-content:space-between; align-items:flex-start; }
    .row { display:flex; gap:12px; align-items:flex-end; flex-wrap:wrap; }
    .row app-input, .row app-select { flex:1; min-width:180px; }
    .mono { font-family:monospace; font-size:15px; }
  `]
})
export class HubExceptions implements OnInit {
  private readonly breadcrumb = inject(BreadcrumbService);
  private readonly notify = inject(NotificationService);
  private readonly auth = inject(AuthService);
  private readonly fb = inject(FormBuilder);
  private readonly shipmentService = inject(ShipmentService);
  private readonly hubOperationsService = inject(HubOperationsService);

  protected readonly myBranchId = this.auth.user()?.branchId ?? null;
  readonly loading = signal(true);
  readonly raising = signal(false);
  readonly resolvingId = signal<string | null>(null);
  readonly page = signal<Page<HubException>>(emptyPage());
  readonly sort = signal<SortState | null>(null);
  readonly typeOptions = TYPE_OPTIONS;

  private query: PageQuery = { page: 0, size: 20 };

  readonly raiseForm = this.fb.nonNullable.group({
    trackingNumber: ['', Validators.required],
    exceptionType: ['', Validators.required],
    remarks: ['']
  });

  readonly columns: TableColumn<HubException>[] = [
    { key: 'exceptionType', header: 'Type' },
    { key: 'shipmentId', header: 'Shipment' },
    { key: 'status', header: 'Status', width: '110px' },
    { key: 'remarks', header: 'Remarks' },
    { key: 'raisedAt', header: 'Raised', width: '140px' },
    { key: 'actions', header: '', width: '120px' }
  ];

  ngOnInit(): void {
    this.breadcrumb.set([{ label: 'Hub Operations' }, { label: 'Exceptions' }]);
    this.load();
  }

  c(name: 'trackingNumber' | 'exceptionType' | 'remarks') {
    return this.raiseForm.controls[name];
  }

  load(): void {
    if (!this.myBranchId) return;
    this.loading.set(true);
    this.hubOperationsService.listExceptions({ ...this.query, hubBranchId: this.myBranchId }).subscribe({
      next: (p) => { this.page.set(p); this.loading.set(false); },
      error: () => this.loading.set(false)
    });
  }

  raise(): void {
    if (this.raiseForm.invalid || !this.myBranchId) return;
    const { trackingNumber, exceptionType, remarks } = this.raiseForm.getRawValue();
    this.raising.set(true);
    this.shipmentService.getByTrackingNumber(trackingNumber).subscribe({
      next: (shipment) => {
        this.hubOperationsService.raiseException({
          shipmentId: shipment.id, hubBranchId: this.myBranchId!,
          exceptionType: exceptionType as HubException['exceptionType'], remarks: remarks || null
        }).subscribe({
          next: () => {
            this.raising.set(false);
            this.notify.success('Exception raised.');
            this.raiseForm.reset({ trackingNumber: '', exceptionType: '', remarks: '' });
            this.load();
          },
          error: (e) => { this.raising.set(false); this.notify.error(e.error?.message ?? 'Could not raise exception.'); }
        });
      },
      error: () => { this.raising.set(false); this.notify.error('No such tracking number.'); }
    });
  }

  resolve(e: HubException): void {
    this.resolvingId.set(e.id);
    this.hubOperationsService.resolveException(e.id, { resolutionRemarks: 'Resolved' }).subscribe({
      next: () => { this.resolvingId.set(null); this.notify.success('Exception resolved.'); this.load(); },
      error: (err) => { this.resolvingId.set(null); this.notify.error(err.error?.message ?? 'Could not resolve.'); }
    });
  }

  onPage(i: number): void {
    this.query = { ...this.query, page: i };
    this.load();
  }

  onSort(s: SortState): void {
    this.sort.set(s);
    this.load();
  }
}
