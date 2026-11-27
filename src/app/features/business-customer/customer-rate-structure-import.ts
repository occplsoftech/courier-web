import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { BreadcrumbService } from '@core/services/breadcrumb.service';
import { NotificationService } from '@core/services/notification.service';
import { UiButton } from '@shared/components/ui-button/ui-button';
import { UiCard } from '@shared/components/ui-card/ui-card';
import { UiSelect, SelectOption } from '@shared/components/ui-select/ui-select';
import {
  BusinessCustomerService, StructureCargoRate, StructureImportResult, StructurePreview, StructureServices
} from './business-customer.service';

/** Cargo grid columns, as on the printed rate card. */
const CARGO_GROUPS = ['WITHIN_STATE', 'REST_OF_INDIA', 'NORTH_EAST'] as const;
const ORIGINS = ['NORTH', 'SOUTH', 'WEST', 'EAST', 'NORTH_EAST'];
const ORIGIN_LABELS: Record<string, string> = { NORTH: 'North', SOUTH: 'South', WEST: 'West', EAST: 'East', NORTH_EAST: 'North East' };

/**
 * Imports a business customer's rate structure from the company's rate card layout: the DOMESTIC AIR COURIER table
 * (per kg by destination group) and the DOMESTIC CARGO table (origin region × Within State / Rest of India / North
 * East, by surface and by air) with its minimum chargeable weight. Each table prices one service type, chosen here.
 */
@Component({
  selector: 'app-customer-rate-structure-import',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, RouterLink, UiButton, UiCard, UiSelect],
  template: `
    <div class="page">
      <header class="page__head">
        <div><h1 class="text-h1">Import Rate Structure</h1>
          <p class="text-caption">Upload the rate card (air courier and cargo tables) for one business customer. For a row-per-district sheet, use <a routerLink="/business-customer/rates/import">Import Customer Rates</a>.</p></div>
        <div class="page__actions"><app-button variant="stroked" icon="download" (pressed)="template()">Download template</app-button></div>
      </header>

      <app-card title="1 · Customer, services and file" subtitle="Each table of the rate card prices one service type. A booking on that service uses this customer's rate.">
        <div class="grid">
          <app-select [control]="customerCtl" label="Customer" [options]="customerOpts()" placeholder="Choose a customer" />
          <app-select [control]="airCtl" label="Air courier service" [options]="serviceOpts()" [allowEmpty]="true" emptyLabel="Not used" placeholder="Not used" />
          <app-select [control]="surfaceCtl" label="Cargo by surface service" [options]="serviceOpts()" [allowEmpty]="true" emptyLabel="Not used" placeholder="Not used" />
          <app-select [control]="cargoAirCtl" label="Cargo by air service" [options]="serviceOpts()" [allowEmpty]="true" emptyLabel="Not used" placeholder="Not used" />
        </div>
        <div class="file">
          <input #f type="file" accept=".xlsx" hidden (change)="choose(f.files)" />
          <app-button icon="upload" [disabled]="!customerCtl.value || busy()" (pressed)="f.click()">{{ file() ? 'Choose another file' : 'Choose file' }}</app-button>
          @if (file(); as fl) { <span class="fname">{{ fl.name }}</span> }
        </div>
      </app-card>

      @if (preview(); as p) {
        <app-card title="2 · Check" [subtitle]="summary(p)">
          @if (p.errors.length) {
            <ul class="issues err">@for (i of p.errors; track $index) { <li>@if (i.row) { Row {{ i.row }}: } {{ i.message }}</li> }</ul>
          }
          @if (p.warnings.length) {
            <ul class="issues warn">@for (i of p.warnings; track $index) { <li>@if (i.row) { Row {{ i.row }}: } {{ i.message }}</li> }</ul>
          }

          @if (p.airCourier.length) {
            <h3 class="sub">Domestic air courier · per kg</h3>
            <table class="t t--narrow">
              <thead><tr><th>Destination</th><th class="r">Per kg</th></tr></thead>
              <tbody>@for (a of p.airCourier; track a.group) { <tr><td>{{ a.groupLabel }}</td><td class="r">₹{{ a.ratePerKg }}</td></tr> }</tbody>
            </table>
          }

          @if (p.cargo.length) {
            <h3 class="sub">Domestic cargo · per kg, surface / air @if (p.cargoMinChargeableKg) { · minimum {{ p.cargoMinChargeableKg }} kg }</h3>
            <div class="scroll">
              <table class="t">
                <thead><tr><th>Starts in</th><th class="r">Within State</th><th class="r">Rest of India</th><th class="r">North East</th></tr></thead>
                <tbody>
                  @for (o of origins(p); track o) {
                    <tr><td>{{ originLabel(o) }}</td>
                      @for (g of groups; track g) { <td class="r">{{ cell(p, o, g) }}</td> }
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          }

          <div class="actions">
            <app-button icon="done_all" [loading]="busy()" [disabled]="p.errors.length > 0" (pressed)="apply()">Import rate structure</app-button>
          </div>
        </app-card>
      }

      @if (done(); as d) {
        <app-card title="Imported">
          <p class="okmsg">{{ d.ratesSaved }} rate(s) saved: {{ d.airCourierRates }} air courier, {{ d.cargoSurfaceRates }} cargo by surface, {{ d.cargoAirRates }} cargo by air. The customer now uses their business rates.</p>
          <div class="actions">
            <app-button icon="list" (pressed)="goList()">View customer rates</app-button>
            <app-button variant="stroked" (pressed)="reset()">Import another sheet</app-button>
          </div>
        </app-card>
      }
    </div>
  `,
  styles: [`
    .grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:16px 20px; }
    .file { display:flex; align-items:center; gap:14px; flex-wrap:wrap; margin-top:16px; }
    .fname { font:500 16px var(--font-sans); color:var(--content-muted); }
    .sub { margin:18px 0 10px; font:600 17px var(--font-sans); }
    .scroll { overflow-x:auto; }
    .t { width:100%; border-collapse:collapse; font:400 16px var(--font-sans); border:1px solid var(--surface-border); border-radius:10px; }
    .t--narrow { max-width:420px; }
    .t th, .t td { padding:10px 12px; text-align:left; border-bottom:1px solid var(--surface-border); }
    .t th { background:var(--surface-muted); color:var(--content-muted); font-weight:600; }
    .t tbody tr:last-child td { border-bottom:0; }
    .t .r { text-align:right; font-variant-numeric:tabular-nums; }
    .issues { margin:0 0 12px; padding:10px 14px 10px 30px; border-radius:10px; font:500 15px var(--font-sans); }
    .issues.err { background:var(--danger-bg, #fdecee); color:var(--danger, #b3123a); }
    .issues.warn { background:#fff4e0; color:#8a5300; }
    .okmsg { margin:0 0 14px; font:500 17px var(--font-sans); }
    .actions { display:flex; gap:12px; margin-top:16px; flex-wrap:wrap; }
    @media (max-width:760px){ .grid { grid-template-columns:1fr; } }
  `]
})
export class CustomerRateStructureImport implements OnInit {
  private readonly service = inject(BusinessCustomerService);
  private readonly breadcrumb = inject(BreadcrumbService);
  private readonly notify = inject(NotificationService);
  private readonly router = inject(Router);

  protected readonly customerCtl = new FormControl<string>('', { nonNullable: true });
  protected readonly airCtl = new FormControl<string>('', { nonNullable: true });
  protected readonly surfaceCtl = new FormControl<string>('', { nonNullable: true });
  protected readonly cargoAirCtl = new FormControl<string>('', { nonNullable: true });
  protected readonly customerOpts = signal<SelectOption[]>([]);
  protected readonly serviceOpts = signal<SelectOption[]>([]);
  protected readonly file = signal<File | null>(null);
  protected readonly preview = signal<StructurePreview | null>(null);
  protected readonly done = signal<StructureImportResult | null>(null);
  protected readonly busy = signal(false);
  protected readonly canCheck = computed(() => !!this.customerCtl.value && !!this.file());
  protected readonly groups = CARGO_GROUPS;

  ngOnInit(): void {
    this.breadcrumb.set([{ label: 'Business Customer' }, { label: 'Rate', route: '/business-customer/rates' }, { label: 'Import rate structure' }]);
    this.service.businessCustomers().subscribe((p) =>
      this.customerOpts.set(p.content.map((c) => ({ value: c.id, label: `${c.displayName} (${c.customerCode})` }))));
    this.service.serviceTypes().subscribe((p) => {
      this.serviceOpts.set(p.content.map((t) => ({ value: t.id, label: `${t.name} (${t.code})` })));
      // Best guesses, by code: AIR prices air courier, SURFACE_CARGO (or the older CARGO) / SURFACE cargo by surface, a CARGO…AIR code cargo by air.
      const find = (test: (code: string) => boolean) => p.content.find((t) => test(t.code.toUpperCase()))?.id ?? '';
      if (!this.airCtl.value) this.airCtl.setValue(find((c) => c === 'AIR'), { emitEvent: false });
      if (!this.surfaceCtl.value) this.surfaceCtl.setValue(find((c) => c === 'SURFACE_CARGO') || find((c) => c === 'CARGO') || find((c) => c === 'SURFACE'), { emitEvent: false });
      if (!this.cargoAirCtl.value) this.cargoAirCtl.setValue(find((c) => c.includes('CARGO') && c.includes('AIR')), { emitEvent: false });
    });
    for (const ctl of [this.customerCtl, this.airCtl, this.surfaceCtl, this.cargoAirCtl]) {
      ctl.valueChanges.subscribe(() => { this.preview.set(null); this.done.set(null); if (this.file()) this.check(); });
    }
  }

  private services(): StructureServices {
    return { airCourier: this.airCtl.value, cargoSurface: this.surfaceCtl.value, cargoAir: this.cargoAirCtl.value };
  }

  protected summary(p: StructurePreview): string {
    const n = p.airCourier.length + p.cargo.reduce((s, c) => s + (c.surface != null ? 1 : 0) + (c.air != null ? 1 : 0), 0);
    return `${n} rate(s) read · ${p.errors.length} error(s) · ${p.warnings.length} note(s)`;
  }

  protected origins(p: StructurePreview): string[] {
    return ORIGINS.filter((o) => p.cargo.some((c) => c.origin === o));
  }

  protected originLabel(o: string): string { return ORIGIN_LABELS[o] ?? o; }

  protected cell(p: StructurePreview, origin: string, group: string): string {
    const c: StructureCargoRate | undefined = p.cargo.find((x) => x.origin === origin && x.group === group);
    if (!c) return '-';
    const s = c.surface != null ? `₹${c.surface}` : '-';
    return group === 'WITHIN_STATE' && c.air == null ? s : `${s} / ${c.air != null ? '₹' + c.air : '-'}`;
  }

  protected template(): void {
    this.service.structureTemplate().subscribe({
      next: (b) => {
        const url = URL.createObjectURL(b);
        const a = document.createElement('a');
        a.href = url; a.download = 'rate-structure-template.xlsx';
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      },
      error: () => this.notify.error('The template could not be downloaded.')
    });
  }

  protected choose(files: FileList | null): void {
    const f = files?.[0];
    if (!f) return;
    if (!f.name.toLowerCase().endsWith('.xlsx')) { this.notify.error('Choose an Excel (.xlsx) file.'); return; }
    this.file.set(f);
    this.done.set(null);
    this.check();
  }

  private check(): void {
    if (!this.canCheck()) return;
    this.busy.set(true);
    this.service.structurePreview(this.customerCtl.value, this.services(), this.file()!).subscribe({
      next: (p) => { this.preview.set(p); this.busy.set(false); },
      error: (e: HttpErrorResponse) => { this.preview.set(null); this.busy.set(false); this.notify.error(e.error?.message ?? 'The file could not be checked.'); }
    });
  }

  protected apply(): void {
    if (!this.canCheck()) return;
    this.busy.set(true);
    this.service.structureApply(this.customerCtl.value, this.services(), this.file()!).subscribe({
      next: (r) => { this.done.set(r); this.preview.set(null); this.busy.set(false); this.notify.success('Rate structure imported.'); },
      error: (e: HttpErrorResponse) => { this.busy.set(false); this.notify.error(e.error?.message ?? 'The import failed. Nothing was saved.'); this.check(); }
    });
  }

  protected reset(): void { this.file.set(null); this.preview.set(null); this.done.set(null); }
  protected goList(): void { this.router.navigate(['/business-customer/rates']); }
}
