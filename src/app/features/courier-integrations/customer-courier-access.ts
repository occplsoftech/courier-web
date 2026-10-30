import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { NotificationService } from '@core/services/notification.service';
import { Customer } from '@core/models/customer.model';
import { UiCard } from '@shared/components/ui-card/ui-card';
import { UiButton } from '@shared/components/ui-button/ui-button';
import { BusinessCustomerService } from '@features/business-customer/business-customer.service';
import { apiMessage } from '@features/communication/api-error';
import { CourierIntegrationService, CustomerCourierAccess } from './courier-integration.service';

/**
 * Which couriers each business customer sees in the shipping portal. A customer with none ticked sees OCCPL Network only; tick
 * Delhivery and only Delhivery's rates are shown to that customer (OCCPL Network too, only if it is ticked as well).
 */
@Component({
  selector: 'app-customer-courier-access',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [UiCard, UiButton],
  template: `
    <app-card title="Customer access" subtitle="Choose which couriers each business customer sees in the shipping portal.">
      <div class="ca">
        <label class="ca__pick">Business customer
          <select [value]="customerId()" (change)="choose($any($event.target).value)" aria-label="Business customer">
            <option value="">Select a customer…</option>
            @for (c of customers(); track c.id) { <option [value]="c.id">{{ c.displayName }} ({{ c.customerCode }})</option> }
          </select>
        </label>

        @if (loading()) { <p class="hint" role="status">Loading…</p> }
        @if (error()) { <p class="alert" role="alert">{{ error() }}</p> }

        @if (access(); as a) {
          <p class="hint">
            @if (a.customised) { This customer sees only the ticked couriers. }
            @else { Nothing is set for this customer, so it sees <strong>OCCPL Network only</strong>. Tick couriers to give it more. }
          </p>
          <ul class="ca__list">
            @for (o of a.couriers; track o.code) {
              <li>
                <label>
                  <input type="checkbox" [checked]="picked().has(o.code)" (change)="toggle(o.code)" />
                  <span class="ca__name">{{ o.name }}</span>
                  @if (!o.connected) { <span class="ca__off">not connected</span> }
                </label>
              </li>
            }
          </ul>
          <div class="ca__bar">
            <span class="hint">{{ picked().size === 0 ? 'None ticked: back to OCCPL Network only.' : picked().size + ' courier(s) ticked.' }}</span>
            <app-button icon="save" [loading]="saving()" [disabled]="!dirty()" (pressed)="save()">Save</app-button>
          </div>
        }
      </div>
    </app-card>
  `,
  styles: [`
    .ca { display:flex; flex-direction:column; gap:12px; }
    .ca__pick { display:flex; flex-direction:column; gap:4px; font:600 13px var(--font-sans); max-width:420px; }
    .ca__pick select { height:40px; border:1px solid var(--surface-border); border-radius:8px; padding:0 10px; background:var(--surface-card, #fff); color:var(--content-fg); font:400 14px var(--font-sans); }
    .ca__list { list-style:none; margin:0; padding:0; display:grid; grid-template-columns:repeat(auto-fill, minmax(240px, 1fr)); gap:8px; }
    .ca__list label { display:flex; align-items:center; gap:10px; padding:10px 12px; border:1px solid var(--surface-border); border-radius:10px; cursor:pointer; }
    .ca__list input { width:1.05rem; height:1.05rem; }
    .ca__name { font:600 14px var(--font-sans); }
    .ca__off { margin-left:auto; font:500 11px var(--font-sans); color:var(--content-muted); }
    .ca__bar { display:flex; justify-content:space-between; align-items:center; gap:12px; flex-wrap:wrap; }
    .hint { font:400 12px var(--font-sans); color:var(--content-muted); margin:0; }
  `]
})
export class CustomerCourierAccessCard implements OnInit {
  private readonly svc = inject(CourierIntegrationService);
  private readonly business = inject(BusinessCustomerService);
  private readonly notify = inject(NotificationService);

  protected readonly customers = signal<Customer[]>([]);
  protected readonly customerId = signal('');
  protected readonly access = signal<CustomerCourierAccess | null>(null);
  protected readonly picked = signal<ReadonlySet<string>>(new Set());
  protected readonly loading = signal(false);
  protected readonly saving = signal(false);
  protected readonly error = signal<string | null>(null);
  private saved = new Set<string>();

  protected readonly dirty = computed(() => {
    const now = this.picked();
    return now.size !== this.saved.size || [...now].some((c) => !this.saved.has(c));
  });

  ngOnInit(): void {
    this.business.businessCustomers().subscribe({ next: (p) => this.customers.set(p.content), error: () => this.error.set('Customers could not be loaded.') });
  }

  protected choose(id: string): void {
    this.customerId.set(id);
    this.access.set(null);
    this.error.set(null);
    if (!id) return;
    this.loading.set(true);
    this.svc.customerAccess(id).subscribe({
      next: (a) => { this.loading.set(false); this.show(a); },
      error: (e: HttpErrorResponse) => { this.loading.set(false); this.error.set(apiMessage(e, 'The courier list could not be loaded.')); }
    });
  }

  /** What is ticked is what the customer sees now; a customer with nothing assigned shows OCCPL Network ticked, as that is what it sees. */
  private show(a: CustomerCourierAccess): void {
    this.access.set(a);
    this.saved = new Set(a.couriers.filter((o) => o.enabled).map((o) => o.code));
    this.picked.set(new Set(this.saved));
  }

  protected toggle(code: string): void {
    const next = new Set(this.picked());
    if (!next.delete(code)) next.add(code);
    this.picked.set(next);
  }

  protected save(): void {
    this.saving.set(true);
    this.svc.saveCustomerAccess(this.customerId(), [...this.picked()]).subscribe({
      next: (a) => { this.saving.set(false); this.show(a); this.notify.success('Courier access saved.'); },
      error: (e: HttpErrorResponse) => { this.saving.set(false); this.notify.error(apiMessage(e, 'The courier access could not be saved.')); }
    });
  }
}
