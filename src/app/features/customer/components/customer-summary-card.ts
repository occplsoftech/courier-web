import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { CustomerStatusBadge } from './customer-status-badge';
import { CustomerResponse } from '@core/models/customer.model';

/** Identity banner for the customer detail view — avatar, name, code, type/status. */
@Component({
  selector: 'app-customer-summary-card',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatIconModule, CustomerStatusBadge],
  template: `
    <div class="cs__id">
      <span class="cs__av"><mat-icon>{{ customer().customerType === 'BUSINESS' ? 'business' : 'person' }}</mat-icon></span>
      <div class="cs__body">
        <div class="cs__name"><h1 class="text-h1">{{ customer().displayName }}</h1>
          <app-customer-status-badge [status]="customer().status" /></div>
        <p class="text-caption mono">{{ customer().customerCode }}</p>
        <div class="cs__tags">
          <span class="tag tag--brand">{{ customer().customerType === 'BUSINESS' ? 'Business' : 'Individual' }}</span>
          <span class="tag"><mat-icon>call</mat-icon>{{ customer().mobile }}</span>
          @if (customer().email) { <span class="tag"><mat-icon>mail</mat-icon>{{ customer().email }}</span> }
        </div>
      </div>
    </div>
  `,
  styles: [`
    .cs__id { display:flex; gap:16px; align-items:flex-start; }
    .cs__av { width:56px; height:56px; border-radius:14px; background:var(--brand-100); color:var(--brand-700); display:grid; place-items:center; flex:0 0 auto; }
    .cs__av mat-icon { font-size:28px; width:28px; height:28px; }
    .cs__name { display:flex; align-items:center; gap:12px; }
    .mono { font-family:var(--font-mono, ui-monospace); }
    .cs__tags { display:flex; flex-wrap:wrap; gap:6px; margin-top:6px; }
    .tag { display:inline-flex; align-items:center; gap:3px; background:var(--surface-muted); border:1px solid var(--surface-border);
      color:var(--content-muted); font:600 14px var(--font-sans); padding:2px 8px; border-radius:6px; }
    .tag mat-icon { font-size:13px; width:13px; height:13px; }
    .tag--brand { background:var(--brand-50); color:var(--brand-700); border-color:var(--brand-100); }
  `]
})
export class CustomerSummaryCard {
  readonly customer = input.required<CustomerResponse>();
}
