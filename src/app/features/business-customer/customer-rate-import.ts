import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { BreadcrumbService } from '@core/services/breadcrumb.service';
import { NotificationService } from '@core/services/notification.service';
import { UiButton } from '@shared/components/ui-button/ui-button';
import { UiCard } from '@shared/components/ui-card/ui-card';
import { UiSelect, SelectOption } from '@shared/components/ui-select/ui-select';
import { BusinessCustomerService, RateImportPreview } from './business-customer.service';

/**
 * Sets up a business customer's whole rate list from one Excel sheet: pick the customer, download the template, upload it, see
 * every row checked, then import in one click. Zones are created from the districts in the sheet; a rate card is saved per zone
 * and service type. Nothing is saved until every row is correct.
 */
@Component({
  selector: 'app-customer-rate-import',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, UiButton, UiCard, UiSelect],
  template: `
    <div class="page">
      <header class="page__head">
        <div><h1 class="text-h1">Import Customer Rates</h1>
          <p class="text-caption">Set up a customer's zones and rates for every service (AIR, SURFACE, CARGO, PREMIUM) from one Excel sheet.</p></div>
        <div class="page__actions"><app-button variant="stroked" icon="download" (pressed)="template()">Download template</app-button></div>
      </header>

      <app-card title="1 · Customer and file" subtitle="Choose the business customer, then the filled .xlsx file (up to 300 rows).">
        <div class="pick">
          <app-select [control]="customerCtl" label="Customer" [options]="customerOpts()" placeholder="Choose a customer" />
          <div class="file">
            <input #f type="file" accept=".xlsx" hidden (change)="choose(f.files)" />
            <app-button icon="upload" [disabled]="!customerCtl.value || busy()" (pressed)="f.click()">{{ file() ? 'Choose another file' : 'Choose file' }}</app-button>
            @if (file(); as fl) { <span class="fname">{{ fl.name }}</span> }
          </div>
        </div>
      </app-card>

      @if (preview(); as p) {
        <app-card title="2 · Check" [subtitle]="p.okCount + ' ready · ' + p.errorCount + ' with errors · ' + p.zoneCount + ' zone(s)'">
          <div class="scroll">
            <table>
              <thead><tr><th>Row</th><th>Zone</th><th>Districts</th><th>Service</th><th>Weight slabs</th></tr></thead>
              <tbody>
                @for (r of p.rows; track r.row) {
                  <tr [class.err]="!r.ok">
                    <td>{{ r.row }}</td><td>{{ r.zone || '—' }}</td><td class="wrap">{{ r.districts.join(', ') || '—' }}</td><td>{{ r.serviceType }}</td>
                    @if (r.ok) { <td class="wrap">{{ r.slabsSummary }}</td> } @else { <td class="wrap msg">{{ r.error }}</td> }
                  </tr>
                }
              </tbody>
            </table>
          </div>
          @if (p.errorCount > 0) { <p class="warn">Fix the rows with errors in your sheet and upload it again. Nothing is saved until every row is correct.</p> }
          <div class="actions">
            <app-button icon="done_all" [loading]="busy()" [disabled]="p.errorCount > 0 || p.okCount === 0" (pressed)="apply()">Import {{ p.okCount }} rate card(s)</app-button>
          </div>
        </app-card>
      }

      @if (done(); as d) {
        <app-card title="Imported">
          <p class="okmsg">{{ d.cardsSaved }} rate card(s) saved · {{ d.zonesCreated }} zone(s) created · {{ d.zonesReused }} existing zone(s) reused. The customer now uses their business rates.</p>
          <div class="actions">
            <app-button icon="list" (pressed)="goList()">View customer rates</app-button>
            <app-button variant="stroked" (pressed)="reset()">Import another sheet</app-button>
          </div>
        </app-card>
      }
    </div>
  `,
  styles: [`
    .pick { display:grid; grid-template-columns:minmax(0,360px) 1fr; gap:20px; align-items:end; }
    .file { display:flex; align-items:center; gap:14px; flex-wrap:wrap; }
    .fname { font:500 13px var(--font-sans); color:var(--content-muted); }
    .scroll { overflow-x:auto; border:1px solid var(--surface-border); border-radius:10px; }
    table { width:100%; min-width:760px; border-collapse:collapse; font:400 13px var(--font-sans); }
    th, td { padding:10px 12px; text-align:left; vertical-align:top; border-bottom:1px solid var(--surface-border); }
    th { background:var(--surface-muted); color:var(--content-muted); font-weight:600; }
    tbody tr:last-child td { border-bottom:0; }
    td.wrap { overflow-wrap:anywhere; }
    tr.err td { background:var(--danger-bg, #fdecee); }
    td.msg { color:var(--danger, #b3123a); }
    .warn { margin:14px 0 0; padding:10px 14px; border-radius:10px; background:#fff4e0; color:#8a5300; font:500 13px var(--font-sans); }
    .okmsg { margin:0 0 14px; font:500 14px var(--font-sans); }
    .actions { display:flex; gap:12px; margin-top:16px; flex-wrap:wrap; }
    @media (max-width:760px){ .pick { grid-template-columns:1fr; } }
  `]
})
export class CustomerRateImport implements OnInit {
  private readonly service = inject(BusinessCustomerService);
  private readonly breadcrumb = inject(BreadcrumbService);
  private readonly notify = inject(NotificationService);
  private readonly router = inject(Router);

  protected readonly customerCtl = new FormControl<string>('', { nonNullable: true });
  protected readonly customerOpts = signal<SelectOption[]>([]);
  protected readonly file = signal<File | null>(null);
  protected readonly preview = signal<RateImportPreview | null>(null);
  protected readonly done = signal<{ zonesCreated: number; zonesReused: number; cardsSaved: number } | null>(null);
  protected readonly busy = signal(false);
  protected readonly canCheck = computed(() => !!this.customerCtl.value && !!this.file());

  ngOnInit(): void {
    this.breadcrumb.set([{ label: 'Business Customer' }, { label: 'Rate', route: '/business-customer/rates' }, { label: 'Import' }]);
    this.service.businessCustomers().subscribe((p) =>
      this.customerOpts.set(p.content.map((c) => ({ value: c.id, label: `${c.displayName} (${c.customerCode})` }))));
    this.customerCtl.valueChanges.subscribe(() => { this.preview.set(null); this.done.set(null); if (this.file()) this.check(); });
  }

  protected template(): void {
    this.service.importTemplate().subscribe({
      next: (b) => {
        const url = URL.createObjectURL(b);
        const a = document.createElement('a');
        a.href = url; a.download = 'customer-rates-template.xlsx';
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
    this.service.importPreview(this.customerCtl.value, this.file()!).subscribe({
      next: (p) => { this.preview.set(p); this.busy.set(false); },
      error: (e: HttpErrorResponse) => { this.preview.set(null); this.busy.set(false); this.notify.error(e.error?.message ?? 'The file could not be checked.'); }
    });
  }

  protected apply(): void {
    if (!this.canCheck()) return;
    this.busy.set(true);
    this.service.importApply(this.customerCtl.value, this.file()!).subscribe({
      next: (r) => { this.done.set(r); this.preview.set(null); this.busy.set(false); this.notify.success('Rates imported.'); },
      error: (e: HttpErrorResponse) => { this.busy.set(false); this.notify.error(e.error?.message ?? 'The import failed. Nothing was saved.'); this.check(); }
    });
  }

  protected reset(): void { this.file.set(null); this.preview.set(null); this.done.set(null); }
  protected goList(): void { this.router.navigate(['/business-customer/rates']); }
}
