import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import { BreadcrumbService } from '@core/services/breadcrumb.service';
import { ApiService } from '@core/services/api.service';
import { NotificationService } from '@core/services/notification.service';
import { UiButton } from '@shared/components/ui-button/ui-button';
import { UiCard } from '@shared/components/ui-card/ui-card';
import { UiInput } from '@shared/components/ui-input/ui-input';
import { UiSelect, SelectOption } from '@shared/components/ui-select/ui-select';
import { BusinessCustomerService } from '@features/business-customer/business-customer.service';

/** One service's price for the route, or why it has none. */
export interface AllRateRow {
  serviceTypeId: string; serviceTypeCode: string; serviceTypeName: string;
  source: string | null; basis: string | null; chargeableWeight: number | null;
  freight: number | null; otherCharges: number | null; gst: number | null; total: number | null;
  deliveryDays: number | null; tatHours: number | null; error: string | null;
}
export interface AllRateResult {
  fromPincode: string; toPincode: string; weightKg: number; packageTypeId: string; packageTypeName: string;
  gstPercent: number; rows: AllRateRow[];
}

/**
 * All to all rate calculator: any from pincode to any to pincode, a weight, and optionally a business customer, priced on
 * every service type at once, the way a booking would price it (customer rate structure, customer pricing zone, Zone
 * Tariff). Nothing is booked.
 */
@Component({
  selector: 'app-all-rate-calculator',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, DecimalPipe, UiButton, UiCard, UiInput, UiSelect],
  template: `
    <div class="page">
      <header class="page__head">
        <div><h1 class="text-h1">All to All Rate Calculator</h1>
          <p class="text-caption">Any pincode to any pincode, every service at once. Pick a business customer to see their own rates.</p></div>
      </header>

      <app-card title="Route and parcel">
        <div class="grid">
          <app-input [control]="fromCtl" label="From pincode" placeholder="411001" [maxLength]="6" [required]="true" />
          <app-input [control]="toCtl" label="To pincode" placeholder="560052" [maxLength]="6" [required]="true" />
          <app-input [control]="weightCtl" label="Chargeable weight (kg)" type="number" [min]="0" [step]="0.1" [required]="true" />
          <app-select [control]="packageCtl" label="Package" [options]="packageOpts()" placeholder="Parcel" />
          <app-select [control]="customerCtl" label="Business customer" [options]="customerOpts()" [allowEmpty]="true"
                      emptyLabel="None (company rates)" placeholder="None (company rates)" />
          <app-input [control]="valueCtl" label="Declared value (₹)" type="number" [min]="0" placeholder="Optional" />
        </div>
        <div class="actions">
          <app-button icon="calculate" [loading]="busy()" [disabled]="!ready()" (pressed)="calculate()">Calculate</app-button>
        </div>
      </app-card>

      @if (result(); as r) {
        <app-card [title]="r.fromPincode + ' → ' + r.toPincode + ' · ' + (r.weightKg | number:'1.0-3') + ' kg · ' + r.packageTypeName"
                  [subtitle]="'GST ' + r.gstPercent + '% as in Settings → Finance. Lowest total first.'">
          <div class="scroll">
            <table class="t">
              <thead><tr><th>Service</th><th>Rate from</th><th class="r">Charged kg</th><th class="r">Freight</th><th class="r">Other charges</th>
                <th class="r">GST</th><th class="r">Total</th><th>Delivery</th></tr></thead>
              <tbody>
                @for (x of sorted(r.rows); track x.serviceTypeId) {
                  <tr [class.na]="!!x.error">
                    <td><div class="svc">{{ x.serviceTypeName }}</div><div class="sub">{{ x.serviceTypeCode }}</div></td>
                    @if (x.error) {
                      <td colspan="7" class="msg">{{ x.error }}</td>
                    } @else {
                      <td><div>{{ x.source }}</div><div class="sub">{{ x.basis }}</div></td>
                      <td class="r">{{ x.chargeableWeight | number:'1.0-3' }}</td>
                      <td class="r">₹{{ x.freight | number:'1.2-2' }}</td>
                      <td class="r">₹{{ x.otherCharges | number:'1.2-2' }}</td>
                      <td class="r">₹{{ x.gst | number:'1.2-2' }}</td>
                      <td class="r total">₹{{ x.total | number:'1.2-2' }}</td>
                      <td>{{ delivery(x) }}</td>
                    }
                  </tr>
                }
              </tbody>
            </table>
          </div>
        </app-card>
      }
    </div>
  `,
  styles: [`
    .grid { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:16px 20px; }
    .actions { display:flex; gap:12px; margin-top:16px; }
    .scroll { overflow-x:auto; }
    .t { width:100%; min-width:900px; border-collapse:collapse; font:400 16px var(--font-sans); }
    .t th, .t td { padding:10px 12px; text-align:left; vertical-align:top; border-bottom:1px solid var(--surface-border); }
    .t th { background:var(--surface-muted); color:var(--content-muted); font-weight:600; white-space:nowrap; }
    .t .r { text-align:right; font-variant-numeric:tabular-nums; white-space:nowrap; }
    .t .total { font-weight:700; }
    .svc { font-weight:600; } .sub { font-size:14px; color:var(--content-muted); }
    tr.na td { color:var(--content-muted); }
    td.msg { font-style:normal; }
    @media (max-width:900px){ .grid { grid-template-columns:1fr; } }
  `]
})
export class AllRateCalculator implements OnInit {
  private readonly api = inject(ApiService);
  private readonly customers = inject(BusinessCustomerService);
  private readonly breadcrumb = inject(BreadcrumbService);
  private readonly notify = inject(NotificationService);

  protected readonly fromCtl = new FormControl<string>('', { nonNullable: true, validators: [Validators.pattern(/^[1-9][0-9]{5}$/)] });
  protected readonly toCtl = new FormControl<string>('', { nonNullable: true, validators: [Validators.pattern(/^[1-9][0-9]{5}$/)] });
  protected readonly weightCtl = new FormControl<number | null>(1);
  protected readonly packageCtl = new FormControl<string>('', { nonNullable: true });
  protected readonly customerCtl = new FormControl<string>('', { nonNullable: true });
  protected readonly valueCtl = new FormControl<number | null>(null);
  protected readonly packageOpts = signal<SelectOption[]>([]);
  protected readonly customerOpts = signal<SelectOption[]>([]);
  protected readonly result = signal<AllRateResult | null>(null);
  protected readonly busy = signal(false);

  ngOnInit(): void {
    this.breadcrumb.set([{ label: 'Zone Tariff' }, { label: 'All to All Rate Calculator' }]);
    this.api.page<{ id: string; name: string; documentType: boolean }>('/master/package-types', { page: 0, size: 100, status: 'ACTIVE' })
      .subscribe({
        next: (p) => {
          this.packageOpts.set(p.content.map((t) => ({ value: t.id, label: t.name })));
          const parcel = p.content.find((t) => !t.documentType) ?? p.content[0];
          if (parcel && !this.packageCtl.value) this.packageCtl.setValue(parcel.id);
        },
        error: () => this.packageOpts.set([])
      });
    // Company admins see the customer list; for anyone else it is simply empty (company rates).
    this.customers.businessCustomers().subscribe({
      next: (p) => this.customerOpts.set(p.content.map((c) => ({ value: c.id, label: `${c.displayName} (${c.customerCode})` }))),
      error: () => this.customerOpts.set([])
    });
  }

  protected ready(): boolean {
    return this.fromCtl.valid && !!this.fromCtl.value && this.toCtl.valid && !!this.toCtl.value && Number(this.weightCtl.value) > 0;
  }

  protected calculate(): void {
    if (!this.ready()) return;
    this.busy.set(true);
    this.api.post<AllRateResult>('/rate-calculator', {
      fromPincode: this.fromCtl.value.trim(), toPincode: this.toCtl.value.trim(), weightKg: Number(this.weightCtl.value),
      packageTypeId: this.packageCtl.value || null, customerId: this.customerCtl.value || null,
      declaredValue: this.valueCtl.value != null && this.valueCtl.value !== ('' as unknown) ? Number(this.valueCtl.value) : null
    }).subscribe({
      next: (r) => { this.result.set(r); this.busy.set(false); },
      error: (e: HttpErrorResponse) => { this.busy.set(false); this.result.set(null); this.notify.error(e.error?.message ?? 'The rates could not be worked out.'); }
    });
  }

  /** Priced services cheapest first, then the ones that cannot carry it. */
  protected sorted(rows: AllRateRow[]): AllRateRow[] {
    return [...rows].sort((a, b) => (a.total == null ? 1 : 0) - (b.total == null ? 1 : 0) || (a.total ?? 0) - (b.total ?? 0));
  }

  protected delivery(x: AllRateRow): string {
    if (x.tatHours != null) return `${x.tatHours} h (${x.deliveryDays} day${x.deliveryDays === 1 ? '' : 's'})`;
    if (x.deliveryDays != null) return x.deliveryDays === 0 ? 'Same day' : `${x.deliveryDays} day${x.deliveryDays === 1 ? '' : 's'}`;
    return '—';
  }
}
