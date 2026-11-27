import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { BreadcrumbService } from '@core/services/breadcrumb.service';
import { NotificationService } from '@core/services/notification.service';
import { UiButton } from '@shared/components/ui-button/ui-button';
import { UiCard } from '@shared/components/ui-card/ui-card';
import { UiSelect, SelectOption } from '@shared/components/ui-select/ui-select';
import { ZoneTariffService } from '@features/zone-tariff/zone-tariff.service';
import {
  BusinessCustomerService, CustomerTariffCard, CustomerTariffOptions, CustomerTariffUpload
} from './business-customer.service';

/**
 * Uploads one business customer's rates from their rate sheet in the old software's layout (Sr, Courier, From zone, To zone,
 * State, City, Mode, Product, Applicable From, Weight From, Weight To, Rate, Rate Type) onto their own zone-tariff card:
 * choose the file, see every lane and every problem row, then upload. Nothing is saved until every row is correct; bookings
 * for the customer then use their card before the company's.
 */
@Component({
  selector: 'app-customer-tariff-upload',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, RouterLink, UiButton, UiCard, UiSelect],
  template: `
    <div class="page">
      <header class="page__head">
        <div><h1 class="text-h1">Upload Rates{{ customerName() ? ' — ' + customerName() : '' }}</h1>
          <p class="text-caption">The customer's rate sheet as exported from the old software: one row per zone, mode, product and weight band.</p></div>
      </header>

      <app-card title="Current rate card" [subtitle]="cards().length ? '' : 'None yet: the first upload creates it.'">
        @for (c of cards(); track c.id) {
          <p class="card-line">
            <a [routerLink]="['/zone-tariff/rate-cards', c.id]">{{ c.code }}</a>
            · from {{ c.fromZoneCode }} · {{ c.laneCount }} lane(s) · from {{ c.effectiveFrom }}
            · <span [class.on]="c.status === 'ACTIVE'">{{ c.status === 'ACTIVE' ? 'Active' : 'Inactive' }}</span>
          </p>
        }
      </app-card>

      <app-card title="1 · Options and file" subtitle="Upload again any time: lanes in the file replace the same lanes; the others stay.">
        <div class="pick">
          <app-select [control]="fromZoneCtl" label="From zone" [options]="fromZoneOpts()" />
          <app-select [control]="stepCtl" label='"Addition 500GM" means' [options]="stepOpts" />
          <div class="file">
            <input #f type="file" accept=".xlsx" hidden (change)="choose(f.files); f.value = ''" />
            <app-button icon="upload" [disabled]="busy()" (pressed)="f.click()">{{ file() ? 'Choose another file' : 'Choose file' }}</app-button>
            @if (file(); as fl) { <span class="fname">{{ fl.name }}</span> }
          </div>
        </div>
      </app-card>

      @if (preview(); as p) {
        <app-card title="2 · Check (nothing saved yet)" [subtitle]="summary(p)">
          @if (p.sheet.errors.length) {
            <div class="scroll">
              <table>
                <thead><tr><th>Row</th><th>Problem</th></tr></thead>
                <tbody>
                  @for (e of p.sheet.errors; track $index) { <tr class="err"><td>{{ e.row ?? '—' }}</td><td class="wrap msg">{{ e.message }}</td></tr> }
                </tbody>
              </table>
            </div>
            <p class="warn">Fix these rows in the sheet and upload it again. Nothing is saved until every row is correct.</p>
          }
          @for (w of p.sheet.warnings; track $index) { <p class="note">{{ w.message }}</p> }
          @if (p.newCard) {
            <p class="note">A new rate card is created for this customer{{ p.chargesFrom ? ', with the charges (fuel, docket…) of company card ' + p.chargesFrom : '' }}.</p>
          }
          <div class="scroll lanes">
            <table>
              <thead><tr><th>To zone</th><th>Service</th><th>Product</th><th>Rates</th><th></th></tr></thead>
              <tbody>
                @for (l of p.sheet.lanes; track $index) {
                  <tr><td>{{ l.toZoneCode }}</td><td>{{ l.serviceTypeCode }}</td><td>{{ l.packageTypeCode }}</td>
                    <td class="wrap">{{ l.summary }}</td><td class="muted">{{ l.replaces ? 'replaces' : 'new' }}</td></tr>
                }
              </tbody>
            </table>
          </div>
          <div class="actions">
            <app-button icon="done_all" [loading]="busy()" [disabled]="p.sheet.errors.length > 0 || p.sheet.lanes.length === 0" (pressed)="upload()">
              Upload {{ p.sheet.lanes.length }} lane(s)</app-button>
          </div>
        </app-card>
      }

      @if (done(); as d) {
        <app-card title="Uploaded">
          <p class="okmsg">{{ d.sheet.lanes.length }} lane(s) saved on {{ d.sheet.rateCardCode }}. {{ d.customerName }} now uses their business rates.</p>
          <div class="actions">
            @if (d.rateCardId) { <app-button icon="table_view" (pressed)="openCard(d.rateCardId)">Open the rate card</app-button> }
            <app-button variant="stroked" (pressed)="back()">Back to customers</app-button>
          </div>
        </app-card>
      }
    </div>
  `,
  styles: [`
    .pick { display:grid; grid-template-columns:minmax(0,240px) minmax(0,240px) 1fr; gap:20px; align-items:end; }
    .file { display:flex; align-items:center; gap:14px; flex-wrap:wrap; }
    .fname { font:500 16px var(--font-sans); color:var(--content-muted); overflow-wrap:anywhere; }
    .card-line { margin:0 0 6px; font:400 16px var(--font-sans); }
    .card-line .on { color:var(--success, #1f8a4c); font-weight:600; }
    .scroll { overflow-x:auto; border:1px solid var(--surface-border); border-radius:10px; }
    .scroll.lanes { margin-top:14px; max-height:480px; overflow-y:auto; }
    table { width:100%; min-width:640px; border-collapse:collapse; font:400 16px var(--font-sans); }
    th, td { padding:10px 12px; text-align:left; vertical-align:top; border-bottom:1px solid var(--surface-border); }
    th { background:var(--surface-muted); color:var(--content-muted); font-weight:600; position:sticky; top:0; }
    tbody tr:last-child td { border-bottom:0; }
    td.wrap { overflow-wrap:anywhere; }
    td.muted { color:var(--content-muted); }
    tr.err td { background:var(--danger-bg, #fdecee); }
    td.msg { color:var(--danger, #b3123a); }
    .warn { margin:14px 0 0; padding:10px 14px; border-radius:10px; background:#fff4e0; color:#8a5300; font:500 16px var(--font-sans); }
    .note { margin:10px 0 0; color:var(--content-muted); font:400 15px var(--font-sans); }
    .okmsg { margin:0 0 14px; font:500 17px var(--font-sans); }
    .actions { display:flex; gap:12px; margin-top:16px; flex-wrap:wrap; }
    @media (max-width:860px){ .pick { grid-template-columns:1fr; } }
  `]
})
export class CustomerTariffUploadPage implements OnInit {
  private readonly service = inject(BusinessCustomerService);
  private readonly zones = inject(ZoneTariffService);
  private readonly breadcrumb = inject(BreadcrumbService);
  private readonly notify = inject(NotificationService);
  private readonly router = inject(Router);
  private readonly customerId = inject(ActivatedRoute).snapshot.paramMap.get('id') ?? '';

  protected readonly customerName = signal('');
  protected readonly cards = signal<CustomerTariffCard[]>([]);
  protected readonly fromZoneOpts = signal<SelectOption[]>([{ value: '', label: 'As in the sheet' }]);
  protected readonly stepOpts: SelectOption[] = [{ value: '0.5', label: 'Each extra 500 g' }, { value: '1', label: 'Each extra 1 kg' }];
  protected readonly fromZoneCtl = new FormControl<string>('', { nonNullable: true });
  protected readonly stepCtl = new FormControl<string>('0.5', { nonNullable: true });
  protected readonly file = signal<File | null>(null);
  protected readonly preview = signal<CustomerTariffUpload | null>(null);
  protected readonly done = signal<CustomerTariffUpload | null>(null);
  protected readonly busy = signal(false);

  ngOnInit(): void {
    this.breadcrumb.set([{ label: 'Business Customer' }, { label: 'Customer', route: '/business-customer/customers' }, { label: 'Upload rates' }]);
    this.service.customer(this.customerId).subscribe({ next: (c) => this.customerName.set(c.displayName) });
    this.loadCards();
    this.zones.zones({ status: 'ACTIVE' }).subscribe((list) => this.fromZoneOpts.set([{ value: '', label: 'As in the sheet' },
      ...list.filter((z) => z.usage !== 'TO').map((z) => ({ value: z.id, label: `${z.code} · ${z.name}` }))]));
    this.fromZoneCtl.valueChanges.subscribe(() => this.check());
    this.stepCtl.valueChanges.subscribe(() => this.check());
  }

  protected summary(p: CustomerTariffUpload): string {
    const s = p.sheet;
    return `${s.rowsRead} row(s) · ${s.lanes.length} lane(s) · ${s.errors.length} problem(s)` + (s.duplicateRows ? ` · ${s.duplicateRows} repeated` : '');
  }

  protected choose(files: FileList | null): void {
    const f = files?.[0];
    if (!f) return;
    if (!f.name.toLowerCase().endsWith('.xlsx')) { this.notify.error('Choose an Excel (.xlsx) file.'); return; }
    this.file.set(f);
    this.done.set(null);
    this.check();
  }

  private opts(): CustomerTariffOptions {
    return { fromZoneId: this.fromZoneCtl.value || null, additionStepKg: this.stepCtl.value === '1' ? 1 : 0.5 };
  }

  private check(): void {
    const f = this.file();
    if (!f) return;
    this.busy.set(true);
    this.service.tariffPreview(this.customerId, this.opts(), f).subscribe({
      next: (p) => { this.preview.set(p); this.busy.set(false); },
      error: (e: HttpErrorResponse) => { this.preview.set(null); this.busy.set(false); this.notify.error(e.error?.message ?? 'The file could not be checked.'); }
    });
  }

  protected upload(): void {
    const f = this.file();
    if (!f) return;
    this.busy.set(true);
    this.service.tariffUpload(this.customerId, this.opts(), f).subscribe({
      next: (r) => {
        this.done.set(r); this.preview.set(null); this.file.set(null); this.busy.set(false);
        this.notify.success(`Uploaded ${r.sheet.lanes.length} lane(s).`);
        this.loadCards();
      },
      error: (e: HttpErrorResponse) => { this.busy.set(false); this.notify.error(e.error?.message ?? 'The upload failed. Nothing was saved.'); this.check(); }
    });
  }

  private loadCards(): void {
    this.service.tariffCards(this.customerId).subscribe({ next: (c) => this.cards.set(c), error: () => this.cards.set([]) });
  }

  protected openCard(id: string): void { this.router.navigate(['/zone-tariff/rate-cards', id]); }
  protected back(): void { this.router.navigate(['/business-customer/customers']); }
}
