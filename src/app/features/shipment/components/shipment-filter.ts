import { ChangeDetectionStrategy, Component, computed, inject, input, output, signal } from '@angular/core';
import { FormBuilder, FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { UiSelect, SelectOption } from '@shared/components/ui-select/ui-select';
import { UiAutocomplete } from '@shared/components/ui-autocomplete/ui-autocomplete';
import { UiButton } from '@shared/components/ui-button/ui-button';
import { MasterDataService } from '@features/masters/master-data.service';
import { ShipmentSearchRequest, ShipmentStatus } from '@core/models/shipment.model';

const STATUSES: SelectOption[] = ([
  'BOOKED', 'READY_FOR_MANIFEST', 'MANIFEST_CREATED', 'DISPATCHED', 'IN_SCAN',
  'OUT_FOR_DELIVERY', 'DELIVERED', 'RETURNED', 'CANCELLED', 'FORWARDED'
] as ShipmentStatus[]).map((s) => ({ value: s, label: s === 'OUT_FOR_DELIVERY' ? 'DRS' : s.split('_').map((w) => w.charAt(0) + w.slice(1).toLowerCase()).join(' ') }));

/** Advanced filter for the shipment list, and for the Booking/Delivery Report screens.
 *  Emits a ShipmentSearchRequest; parent merges it in. `mode` swaps the date range from
 *  `bookingDate` (default, and the only option the shipment list ever used) to
 *  `deliveredAt` for the Delivery Report — same two fields, different meaning, so one
 *  component serves both rather than a near-duplicate filter form. */
@Component({
  selector: 'app-shipment-filter',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, UiSelect, UiAutocomplete, UiButton],
  template: `
    <form [formGroup]="form" (ngSubmit)="apply()" class="cf">
      <app-select [control]="c('status')" label="Status" [options]="statusOptions()" [multiple]="true" placeholder="Any status" />
      @if (!lockBookingBranch()) {
        <app-autocomplete [control]="c('bookingBranchId')" label="Booking Branch" [options]="branchOptions()" placeholder="Any branch" />
      }
      @if (!lockDeliveryBranch()) {
        <app-autocomplete [control]="c('deliveryBranchId')" label="Delivery Branch" [options]="branchOptions()" placeholder="Any branch" />
      }
      <app-select [control]="c('paymentModeId')" label="Payment Mode" [options]="paymentModeOptions()" placeholder="Any payment mode" />

      <label class="fld"><span class="fld__l">{{ mode() === 'delivery' ? 'Delivered From' : 'Booked From' }}</span>
        <input class="fld__i" type="date" [formControl]="c('dateFrom')" /></label>
      <label class="fld"><span class="fld__l">{{ mode() === 'delivery' ? 'Delivered To' : 'Booked To' }}</span>
        <input class="fld__i" type="date" [formControl]="c('dateTo')" /></label>

      <div class="cf__bar">
        <app-button variant="text" (pressed)="clear()">Clear all</app-button>
        <app-button type="submit" icon="filter_list">Apply filters</app-button>
      </div>
    </form>
  `,
  styles: [`
    .cf { display:flex; flex-direction:column; gap:16px; }
    .fld { display:flex; flex-direction:column; gap:6px; }
    .fld__l { font:500 13px var(--font-sans); color:var(--content-fg); }
    .fld__i { height:42px; padding:0 12px; background:var(--surface); border:1px solid var(--surface-border);
      border-radius:var(--r-field); font:400 14px var(--font-sans); color:var(--content-fg); }
    .cf__bar { display:flex; justify-content:space-between; gap:10px; margin-top:8px; }
  `]
})
export class ShipmentFilter {
  private readonly fb = inject(FormBuilder);
  private readonly masters = inject(MasterDataService);
  readonly changed = output<ShipmentSearchRequest>();
  /** Set by ShipmentList for a branch-scoped viewer — the list already fixes
   *  bookingBranchId to their own branch, so the picker would just be misleading. */
  readonly lockBookingBranch = input(false);
  /** Set by DeliveryReport for a branch-scoped viewer — the report already fixes
   *  deliveryBranchId to their own branch, so the picker would just be misleading. */
  readonly lockDeliveryBranch = input(false);
  readonly mode = input<'booking' | 'delivery'>('booking');
  /** Reports never list cancelled orders (see Cancelled Orders Report) — hides that status choice. */
  readonly excludeCancelled = input(false);

  protected readonly statusOptions = computed(() =>
    this.excludeCancelled() ? STATUSES.filter((s) => s.value !== 'CANCELLED') : STATUSES);
  protected readonly branchOptions = signal<SelectOption[]>([]);
  protected readonly paymentModeOptions = signal<SelectOption[]>([]);

  protected readonly form: FormGroup = this.fb.group({
    status: [[] as string[]],
    bookingBranchId: [null as string | null],
    deliveryBranchId: [null as string | null],
    paymentModeId: [null as string | null],
    dateFrom: [''],
    dateTo: ['']
  });

  constructor() {
    this.masters.options('branches').subscribe((o) => this.branchOptions.set(o));
    this.masters.options('payment-modes').subscribe((o) => this.paymentModeOptions.set(o));
  }

  protected c(name: string): FormControl { return this.form.get(name) as FormControl; }

  protected apply(): void {
    const v = this.form.getRawValue();
    const dateKeys = this.mode() === 'delivery'
      ? { deliveredDateFrom: v.dateFrom || undefined, deliveredDateTo: v.dateTo || undefined }
      : { bookingDateFrom: v.dateFrom || undefined, bookingDateTo: v.dateTo || undefined };
    this.changed.emit({
      status: v.status?.length ? (v.status as ShipmentStatus[]) : undefined,
      bookingBranchId: v.bookingBranchId || undefined,
      deliveryBranchId: v.deliveryBranchId || undefined,
      paymentModeId: v.paymentModeId || undefined,
      ...dateKeys
    });
  }

  protected clear(): void {
    this.form.reset({ status: [], bookingBranchId: null, deliveryBranchId: null, paymentModeId: null, dateFrom: '', dateTo: '' });
    this.changed.emit({});
  }
}
