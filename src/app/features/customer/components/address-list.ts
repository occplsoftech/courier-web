import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { CustomerAddress } from '@core/models/customer.model';
import { CustomerStatusBadge } from './customer-status-badge';

export type AddressAction = 'edit' | 'delete';

/**
 * A customer's address book — one card per address, with the type, resolved lines and
 * the two "default" badges. Gated actions (edit / delete) come from the parent; delete is
 * `COMPANY_ADMIN` only on the backend, so a caller without it simply omits `canDelete`.
 */
@Component({
  selector: 'app-address-list',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatIconModule, MatMenuModule, CustomerStatusBadge],
  template: `
    @if (!addresses().length) {
      <p class="empty">No addresses on file yet.</p>
    } @else {
      <div class="al">
        @for (a of addresses(); track a.id) {
          <div class="al__row">
            <div class="al__icon"><mat-icon>{{ icon(a.addressType) }}</mat-icon></div>
            <div class="al__body">
              <div class="al__head">
                <strong>{{ pretty(a.addressType) }}</strong>
                <span class="chip chip--usage">{{ usageLabel(a.addressUsage) }}</span>
                @if (a.isDefaultPickup) { <span class="chip chip--pickup">Default Pickup</span> }
                @if (a.isDefaultDelivery) { <span class="chip chip--delivery">Default Delivery</span> }
                <app-customer-status-badge [status]="a.status" />
              </div>
              <p class="al__lines">{{ a.addressLine1 }}@if (a.addressLine2) {, {{ a.addressLine2 }}}@if (a.landmark) { — {{ a.landmark }}}</p>
            </div>
            <div class="al__actions" (click)="$event.stopPropagation()">
              <button class="kebab" [matMenuTriggerFor]="menu" aria-label="Actions"><mat-icon>more_vert</mat-icon></button>
              <mat-menu #menu="matMenu">
                @if (canUpdate()) {
                  <button mat-menu-item (click)="action.emit({ type: 'edit', address: a })"><mat-icon>edit</mat-icon><span>Edit</span></button>
                }
                @if (canDelete()) {
                  <button mat-menu-item class="danger" (click)="action.emit({ type: 'delete', address: a })"><mat-icon>delete</mat-icon><span>Delete</span></button>
                }
              </mat-menu>
            </div>
          </div>
        }
      </div>
    }
  `,
  styles: [`
    .empty { font:400 17px var(--font-sans); color:var(--content-muted); text-align:center; padding:16px; }
    .al { display:flex; flex-direction:column; gap:10px; }
    .al__row { display:flex; gap:14px; align-items:flex-start; padding:12px 14px; border:1px solid var(--surface-border); border-radius:var(--r-field); }
    .al__icon { width:36px; height:36px; border-radius:10px; background:var(--surface-muted); color:var(--content-muted); display:grid; place-items:center; flex:0 0 auto; }
    .al__body { flex:1; min-width:0; }
    .al__head { display:flex; align-items:center; gap:8px; flex-wrap:wrap; }
    .al__head strong { font:600 17px var(--font-sans); color:var(--content-fg); }
    .al__lines { margin:4px 0 0; font:400 16px var(--font-sans); color:var(--content-muted); }
    .chip { font:600 13px var(--font-sans); padding:2px 8px; border-radius:999px; }
    .chip--usage { background:var(--surface-muted); color:var(--content-muted); }
    .chip--pickup { background:var(--brand-50); color:var(--brand-700); }
    .chip--delivery { background:var(--success-bg); color:var(--success); }
    .al__actions { flex:0 0 auto; }
    .kebab { border:0; background:transparent; cursor:pointer; color:var(--content-muted); display:inline-flex; padding:4px; border-radius:8px; }
    .kebab:hover { background:var(--surface-muted); }
    .danger { color:var(--danger); }
  `]
})
export class AddressList {
  readonly addresses = input<CustomerAddress[]>([]);
  readonly canUpdate = input(false);
  readonly canDelete = input(false);

  readonly action = output<{ type: AddressAction; address: CustomerAddress }>();

  icon(type: string): string {
    return type === 'OFFICE' ? 'business' : type === 'WAREHOUSE' ? 'warehouse' : 'home';
  }
  usageLabel(v: string | null | undefined): string { return v === 'PICKUP' ? 'Pickup' : v === 'DELIVERY' ? 'Delivery' : 'Pickup & Delivery'; }
  pretty(v: string): string { return (v || '').charAt(0) + (v || '').slice(1).toLowerCase(); }
}
