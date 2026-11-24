import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { ActivatedRoute, Router } from '@angular/router';
import { BreadcrumbService } from '@core/services/breadcrumb.service';
import { NotificationService } from '@core/services/notification.service';
import { CreateCustomerRequest, CustomerType, UpdateCustomerRequest } from '@core/models/customer.model';
import { CustomerForm, ZoneType } from './components/customer-form';
import { BusinessCustomerService } from '@features/business-customer/business-customer.service';
import { CustomerService } from './customer.service';

/** Create Customer — wraps CustomerForm in create mode and posts. */
@Component({
  selector: 'app-customer-create',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CustomerForm],
  template: `
    <div class="page">
      <header class="page__head">
        <div><h1 class="text-h1">New Customer</h1><p class="text-caption">Register reusable customer master data for your company.</p></div>
      </header>
      <app-customer-form mode="create" [initialType]="initialType" [saving]="saving()" (logoPicked)="logo = $event" (zoneTypePicked)="zoneType = $event" (saved)="save($event)" (cancelled)="cancel()" />
    </div>
  `
})
export class CustomerCreate {
  private readonly service = inject(CustomerService);
  private readonly breadcrumb = inject(BreadcrumbService);
  private readonly notify = inject(NotificationService);
  private readonly router = inject(Router);

  readonly saving = signal(false);
  /** The logo chosen in the form, uploaded once the customer exists. */
  protected logo: File | null = null;
  /** Business customers: the zone type picked in the form. */
  protected zoneType: ZoneType = 'DEFAULT';
  private readonly business = inject(BusinessCustomerService);
  protected readonly initialType: CustomerType =
    inject(ActivatedRoute).snapshot.queryParamMap.get('type') === 'BUSINESS' ? 'BUSINESS' : 'INDIVIDUAL';

  constructor() {
    this.breadcrumb.set([{ label: 'Customers', route: '/customers' }, { label: 'New' }]);
  }

  save(body: CreateCustomerRequest | UpdateCustomerRequest): void {
    this.saving.set(true);
    this.service.create(body as CreateCustomerRequest).subscribe({
      next: (c) => {
        const customize = c.customerType === 'BUSINESS' && this.zoneType === 'CUSTOMIZE';
        const finish = () => {
          this.saving.set(false);
          if (customize) {
            // Customize: this customer is priced from its own zones, so create the first one now.
            this.notify.success(`Customer ${c.customerCode} created. Now create its pricing zone.`);
            this.router.navigate(['/business-customer/pricing-zones/new'], { queryParams: { customerId: c.id } });
          } else {
            this.notify.success(`Customer ${c.customerCode} created.`);
            this.router.navigate(['/customers', c.id]);
          }
        };
        const done = () => {
          if (!customize) { finish(); return; }
          this.business.setRateSource(c.id, true).subscribe({
            next: finish,
            error: () => { this.notify.error('The customer was created, but Customize could not be saved. Set it on the Pricing Zones page.'); finish(); }
          });
        };
        if (!this.logo) { done(); return; }
        this.service.uploadLogo(c.id, this.logo).subscribe({
          next: done,
          error: () => { this.notify.error('The customer was created, but the logo could not be saved. Upload it from Edit.'); done(); }
        });
      },
      error: (err: HttpErrorResponse) => {
        this.saving.set(false);
        if (err.status === 409) this.notify.error(err.error?.message ?? 'Customer code or mobile already in use.');
        else if (err.status === 400 || err.status === 422) this.notify.error(err.error?.message ?? 'Please correct the highlighted fields.');
        else this.notify.error('Could not create the customer.');
      }
    });
  }

  cancel(): void { this.router.navigate(['/customers']); }
}
