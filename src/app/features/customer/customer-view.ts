import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { MatMenuModule } from '@angular/material/menu';
import { MatIconModule } from '@angular/material/icon';
import { MatDialog } from '@angular/material/dialog';
import { BreadcrumbService } from '@core/services/breadcrumb.service';
import { NotificationService } from '@core/services/notification.service';
import { PermissionService } from '@core/auth/permission.service';
import { AppRole } from '@core/models/role.model';
import {
  BILLING_FREQUENCY_LABELS, BillingFrequency, CustomerAddress, CustomerPaymentMode, CustomerResponse, PAYMENT_MODE_LABELS
} from '@core/models/customer.model';
import { UiCard } from '@shared/components/ui-card/ui-card';
import { UiLoader } from '@shared/components/ui-loader/ui-loader';
import { UiButton } from '@shared/components/ui-button/ui-button';
import { DialogService } from '@shared/components/ui-dialog/dialog.service';
import { CustomerSummaryCard } from './components/customer-summary-card';
import { PortalAccessCard } from './components/portal-access-card';
import { CustomerWalletCard } from './components/customer-wallet-card';
import { AddressList, AddressAction } from './components/address-list';
import { AddressFormDialog } from './components/address-form-dialog';
import { CustomerService } from './customer.service';

const WRITERS = [AppRole.COMPANY_ADMIN, AppRole.BRANCH_MANAGER, AppRole.BOOKING_OPERATOR, AppRole.CUSTOMER_SERVICE];
const LIFECYCLE = [AppRole.COMPANY_ADMIN, AppRole.BRANCH_MANAGER];
const ADDRESS_DELETERS = [AppRole.COMPANY_ADMIN];

/** View Customer — full read-only profile, its address book, and the gated action bar. */
@Component({
  selector: 'app-customer-view',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DatePipe, MatMenuModule, MatIconModule, UiCard, UiLoader, UiButton, CustomerSummaryCard, AddressList, PortalAccessCard, CustomerWalletCard],
  template: `
    <div class="page">
      @if (loading()) {
        <app-loader [minHeight]="320" caption="Loading…" />
      } @else if (!customer()) {
        <app-card><p class="empty">Customer not found or outside your scope.</p></app-card>
      } @else {
        <header class="cv__banner app-card">
          <app-customer-summary-card [customer]="customer()!" />
          <div class="cv__actions">
            <app-button variant="stroked" icon="support_agent" (pressed)="raiseTicket()">Raise Ticket</app-button>
            <app-button variant="stroked" icon="event_repeat" (pressed)="createFollowUp()">Create Follow-up</app-button>
            @if (can().update) { <app-button variant="stroked" icon="edit" (pressed)="edit()">Edit</app-button> }
            @if (can().lifecycle) {
              <button class="kebab" [matMenuTriggerFor]="menu"><mat-icon>more_vert</mat-icon></button>
              <mat-menu #menu="matMenu">
                @if (customer()!.status === 'INACTIVE') {
                  <button mat-menu-item (click)="lifecycle('activate')"><mat-icon>check_circle</mat-icon><span>Activate</span></button>
                } @else {
                  <button mat-menu-item (click)="deactivate()"><mat-icon>block</mat-icon><span>Deactivate</span></button>
                }
              </mat-menu>
            }
          </div>
        </header>

        <div class="cv__grid">
          <app-card title="Contact">
            <dl class="kv">
              <dt>First Name</dt><dd>{{ customer()!.firstName }}</dd>
              <dt>Middle Name</dt><dd>{{ customer()!.middleName || '—' }}</dd>
              <dt>Last Name</dt><dd>{{ customer()!.lastName }}</dd>
              @if (customer()!.companyName) { <dt>Company Name</dt><dd>{{ customer()!.companyName }}</dd> }
              <dt>Mobile</dt><dd>{{ customer()!.mobile }}</dd>
              <dt>Alternate Mobile</dt><dd>{{ customer()!.alternateMobile || '—' }}</dd>
              <dt>Email</dt><dd>{{ customer()!.email || '—' }}</dd>
            </dl>
          </app-card>

          <app-card title="Business Details">
            <dl class="kv">
              <dt>Contact Person</dt><dd>{{ customer()!.contactPerson || '—' }}</dd>
              <dt>Payment Mode</dt><dd>{{ paymentLabel(customer()!.defaultPaymentMode) }}</dd>
              <dt>Billing Frequency</dt><dd>{{ frequencyLabel(customer()!.billingFrequency) }}</dd>
              <dt>Billing Address</dt><dd>{{ billingAddress() || '—' }}</dd>
            </dl>
          </app-card>

          <app-card title="Brand">
            <dl class="kv">
              <dt>Logo</dt>
              <dd>@if (logoUrl()) { <img class="cv__logo" [src]="logoUrl()!" alt="Brand logo" /> } @else { — }</dd>
              <dt>Website</dt>
              <dd>@if (customer()!.website) { <a [href]="customer()!.website!" target="_blank" rel="noopener noreferrer">{{ customer()!.website }}</a> } @else { — }</dd>
            </dl>
          </app-card>

          <app-card title="Tax Details">
            <dl class="kv">
              <dt>GST Number</dt><dd class="mono">{{ customer()!.gstNumber || '—' }}</dd>
              <dt>PAN Number</dt><dd class="mono">{{ customer()!.panNumber || '—' }}</dd>
            </dl>
          </app-card>

          <app-card title="Audit">
            <dl class="kv">
              <dt>Customer Code</dt><dd class="mono">{{ customer()!.customerCode }}</dd>
              <dt>Created</dt><dd>{{ customer()!.createdDate ? (customer()!.createdDate | date:'medium') : '—' }}</dd>
              <dt>Last Updated</dt><dd>{{ customer()!.updatedDate ? (customer()!.updatedDate | date:'medium') : '—' }}</dd>
              <dt>Version</dt><dd>{{ customer()!.version }}</dd>
            </dl>
          </app-card>

          @if (can().portalAccess && customer()!.customerType === 'BUSINESS') {
            <app-portal-access-card [customerId]="customer()!.id" [customerEmail]="customer()!.email ?? null" />
          }

          @if (can().walletRead && customer()!.customerType === 'BUSINESS') {
            <app-customer-wallet-card [customerId]="customer()!.id" [customerName]="customer()!.displayName" [canAdjust]="can().walletAdjust" />
          }

          <app-card title="Addresses" subtitle="Pickup and delivery locations on file for this customer.">
            @if (canAddAddress()) {
              <div class="cv__addr-bar">
                <app-button variant="stroked" icon="add_location_alt" (pressed)="addAddress()">Add Address</app-button>
              </div>
            }
            <app-address-list [addresses]="customer()!.addresses" [canUpdate]="canAddAddress()" [canDelete]="canDeleteAddress()"
                              (action)="onAddressAction($event)" />
          </app-card>
        </div>
      }
    </div>
  `,
  styles: [`
    .cv__logo { max-width:120px; max-height:64px; object-fit:contain; }
    .cv__banner { display:flex; align-items:flex-start; justify-content:space-between; gap:16px; padding:20px 24px; margin-bottom:16px; }
    .cv__actions { display:flex; gap:10px; align-items:center; flex:0 0 auto; }
    .kebab { border:1px solid var(--surface-border); background:var(--surface); cursor:pointer; color:var(--content-muted);
      display:inline-flex; padding:8px; border-radius:8px; }
    .kebab:hover { background:var(--surface-muted); }
    .cv__grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:16px; }
    .cv__grid app-card:last-child { grid-column:1 / -1; }
    .cv__addr-bar { display:flex; justify-content:flex-end; margin-bottom:12px; }
    .kv { display:grid; grid-template-columns:160px 1fr; gap:10px 16px; margin:0; }
    .kv dt { font:500 13px var(--font-sans); color:var(--content-muted); }
    .kv dd { font:600 14px var(--font-sans); color:var(--content-fg); margin:0; }
    .mono { font-family:var(--font-mono, ui-monospace); }
    .empty { font:400 14px var(--font-sans); color:var(--content-muted); text-align:center; padding:24px; }
    @media (max-width:860px){ .cv__grid { grid-template-columns:1fr; } }
  `]
})
export class CustomerView implements OnInit {
  protected paymentLabel(v: CustomerPaymentMode | null | undefined): string { return v ? PAYMENT_MODE_LABELS[v] : '—'; }
  protected frequencyLabel(v: BillingFrequency | null | undefined): string { return v ? BILLING_FREQUENCY_LABELS[v] : '—'; }
  protected billingAddress(): string {
    const c = this.customer();
    return c ? [c.billingAddressLine1, c.billingAddressLine2, c.billingCity, c.billingState, c.billingPincode]
      .filter((p) => !!p).join(', ') : '';
  }
  private readonly service = inject(CustomerService);
  private readonly breadcrumb = inject(BreadcrumbService);
  private readonly notify = inject(NotificationService);
  private readonly perms = inject(PermissionService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly confirm = inject(DialogService);
  private readonly dialog = inject(MatDialog);

  readonly loading = signal(true);
  readonly customer = signal<CustomerResponse | null>(null);
  readonly logoUrl = signal<string | null>(null);
  private id = '';

  readonly can = computed(() => ({
    update: this.perms.canAccess({ roles: WRITERS, permissions: ['CUSTOMER_UPDATE'] }),
    lifecycle: this.perms.canAccess({ roles: LIFECYCLE, permissions: ['CUSTOMER_ACTIVATE', 'CUSTOMER_DEACTIVATE'] }),
    // Server-side COMPANY_ADMIN only; no separate permission code exists for it.
    portalAccess: this.perms.hasAnyRole([AppRole.COMPANY_ADMIN]),
    // The wallet's reads are COMPANY_ADMIN / FINANCE_USER on the server, its credit and debit COMPANY_ADMIN only.
    walletRead: this.perms.hasAnyRole([AppRole.COMPANY_ADMIN, AppRole.FINANCE_USER]),
    walletAdjust: this.perms.hasAnyRole([AppRole.COMPANY_ADMIN])
  }));
  readonly canAddAddress = computed(() => this.perms.canAccess({ roles: WRITERS, permissions: ['ADDRESS_CREATE'] }));
  readonly canDeleteAddress = computed(() => this.perms.canAccess({ roles: ADDRESS_DELETERS, permissions: ['ADDRESS_DELETE'] }));

  ngOnInit(): void {
    this.id = this.route.snapshot.paramMap.get('id') ?? '';
    this.load();
  }

  private load(): void {
    this.loading.set(true);
    this.service.get(this.id).subscribe({
      next: (c) => {
        this.customer.set(c);
        if (c.hasLogo) this.service.logo(this.id).subscribe({ next: (l) => this.logoUrl.set(l.dataUrl), error: () => undefined });
        this.breadcrumb.set([{ label: 'Customers', route: '/customers' }, { label: c.displayName }]);
        this.loading.set(false);
      },
      error: () => { this.customer.set(null); this.loading.set(false); }
    });
  }

  private reload(): void { this.service.get(this.id).subscribe((c) => this.customer.set(c)); }

  edit(): void { this.router.navigate(['/customers', this.id, 'edit']); }

  raiseTicket(): void { this.router.navigate(['/support/tickets/new'], { queryParams: { customerId: this.id } }); }
  createFollowUp(): void { this.router.navigate(['/follow-ups/new'], { queryParams: { customerId: this.id } }); }

  lifecycle(op: 'activate'): void {
    this.service[op](this.id).subscribe({
      next: () => { this.notify.success(`Customer ${op}d.`); this.reload(); },
      error: (e) => this.notify.error(e?.error?.message ?? `Could not ${op} the customer.`)
    });
  }

  deactivate(): void {
    this.confirm.confirm({
      title: 'Deactivate customer',
      message: `"${this.customer()!.displayName}" will be withdrawn from the booking pickers until reactivated.`,
      confirmLabel: 'Deactivate', danger: true
    }).subscribe((ok) => {
      if (!ok) return;
      this.service.deactivate(this.id).subscribe({
        next: () => { this.notify.success('Customer deactivated.'); this.reload(); },
        error: (e) => this.notify.error(e?.error?.message ?? 'Could not deactivate the customer.')
      });
    });
  }

  addAddress(): void {
    this.dialog.open(AddressFormDialog, {
      autoFocus: false, panelClass: 'app-dialog', data: { customerId: this.id }
    }).afterClosed().subscribe((created) => { if (created) this.reload(); });
  }

  onAddressAction({ type, address }: { type: AddressAction; address: CustomerAddress }): void {
    if (type === 'edit') return this.editAddress(address);
    return this.deleteAddress(address);
  }

  private editAddress(address: CustomerAddress): void {
    this.dialog.open(AddressFormDialog, {
      autoFocus: false, panelClass: 'app-dialog', data: { customerId: this.id, address }
    }).afterClosed().subscribe((updated) => { if (updated) this.reload(); });
  }

  private deleteAddress(address: CustomerAddress): void {
    this.confirm.confirm({
      title: 'Delete address',
      message: `This ${address.addressType.toLowerCase()} address will be removed from ${this.customer()!.displayName}.`,
      confirmLabel: 'Delete', danger: true
    }).subscribe((ok) => {
      if (!ok) return;
      this.service.removeAddress(this.id, address.id).subscribe({
        next: () => { this.notify.success('Address deleted.'); this.reload(); },
        error: (e) => this.notify.error(e?.error?.message ?? 'Could not delete the address.')
      });
    });
  }
}
