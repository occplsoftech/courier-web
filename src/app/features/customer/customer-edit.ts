import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { ActivatedRoute, Router } from '@angular/router';
import { BreadcrumbService } from '@core/services/breadcrumb.service';
import { NotificationService } from '@core/services/notification.service';
import { CustomerResponse, CreateCustomerRequest, UpdateCustomerRequest } from '@core/models/customer.model';
import { UiCard } from '@shared/components/ui-card/ui-card';
import { UiLoader } from '@shared/components/ui-loader/ui-loader';
import { CustomerForm, ZoneType } from './components/customer-form';
import { BusinessCustomerService } from '@features/business-customer/business-customer.service';
import { CustomerService } from './customer.service';

/** Edit Customer — loads the customer, PUTs a full replacement, handles 409. */
@Component({
  selector: 'app-customer-edit',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [UiCard, UiLoader, CustomerForm],
  template: `
    <div class="page">
      <header class="page__head">
        <div><h1 class="text-h1">Edit Customer</h1><p class="text-caption">Update the customer. Code is immutable; status has its own actions.</p></div>
      </header>
      @if (loading()) {
        <app-loader [minHeight]="280" caption="Loading…" />
      } @else if (!customer()) {
        <app-card><p class="empty">Customer not found or outside your scope.</p></app-card>
      } @else {
        <app-customer-form mode="edit" [customer]="customer()" [logoUrl]="logoUrl()" [saving]="saving()" [initialZoneType]="zoneType()" (zoneTypePicked)="pickedZoneType = $event" (logoPicked)="logo = $event" (saved)="save($event)" (cancelled)="cancel()" />
      }
    </div>
  `,
  styles: [`.empty{ font:400 17px var(--font-sans); color:var(--content-muted); text-align:center; padding:24px; }`]
})
export class CustomerEdit implements OnInit {
  private readonly service = inject(CustomerService);
  private readonly breadcrumb = inject(BreadcrumbService);
  private readonly notify = inject(NotificationService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  readonly loading = signal(true);
  readonly saving = signal(false);
  readonly customer = signal<CustomerResponse | null>(null);
  readonly logoUrl = signal<string | null>(null);
  /** undefined = untouched, a File = replace, null = remove. */
  protected logo: File | null | undefined = undefined;
  /** Business customers: the zone type as saved, and as picked in the form. */
  protected readonly zoneType = signal<ZoneType>('DEFAULT');
  protected pickedZoneType: ZoneType | null = null;
  private readonly business = inject(BusinessCustomerService);
  private id = '';

  ngOnInit(): void {
    this.id = this.route.snapshot.paramMap.get('id') ?? '';
    this.load();
  }

  private load(): void {
    this.loading.set(true);
    this.service.get(this.id).subscribe({
      next: (c) => {
        this.customer.set(c);
        this.breadcrumb.set([{ label: 'Customers', route: '/customers' }, { label: c.displayName, route: `/customers/${this.id}` }, { label: 'Edit' }]);
        this.loading.set(false);
        if (c.customerType === 'BUSINESS') {
          this.business.rateSource(this.id).subscribe({ next: (r) => this.zoneType.set(r?.useBusinessRates ? 'CUSTOMIZE' : 'DEFAULT'), error: () => undefined });
        }
        if (c.hasLogo) this.service.logo(this.id).subscribe({ next: (l) => this.logoUrl.set(l.dataUrl), error: () => undefined });
      },
      error: () => { this.customer.set(null); this.loading.set(false); }
    });
  }

  save(body: CreateCustomerRequest | UpdateCustomerRequest): void {
    this.saving.set(true);
    this.service.update(this.id, body as UpdateCustomerRequest).subscribe({
      next: () => {
        const finish = () => { this.saving.set(false); this.notify.success('Customer updated.'); this.router.navigate(['/customers', this.id]); };
        const picked = this.pickedZoneType;
        const done = () => {
          if (!picked || picked === this.zoneType()) { finish(); return; }
          this.business.setRateSource(this.id, picked === 'CUSTOMIZE').subscribe({
            next: () => { this.zoneType.set(picked); finish(); },
            error: () => { this.notify.error('The customer was saved, but the zone type could not be changed.'); finish(); }
          });
        };
        if (this.logo === undefined) { done(); return; }
        const call = this.logo ? this.service.uploadLogo(this.id, this.logo) : this.service.removeLogo(this.id);
        call.subscribe({
          next: done,
          error: () => { this.notify.error('The customer was saved, but the logo could not be updated. Try again from Edit.'); done(); }
        });
      },
      error: (err: HttpErrorResponse) => {
        this.saving.set(false);
        if (err.status === 409) { this.notify.error('This customer changed since you opened it. Reloading the latest version.'); this.load(); }
        else if (err.status === 400 || err.status === 422) this.notify.error(err.error?.message ?? 'Please correct the highlighted fields.');
        else this.notify.error('Could not update the customer.');
      }
    });
  }

  cancel(): void { this.router.navigate(['/customers', this.id]); }
}
