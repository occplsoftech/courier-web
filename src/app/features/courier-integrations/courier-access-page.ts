import { ChangeDetectionStrategy, Component, OnInit, inject } from '@angular/core';
import { BreadcrumbService } from '@core/services/breadcrumb.service';
import { BranchCourierAccessCard } from './branch-courier-access';
import { CustomerCourierAccessCard } from './customer-courier-access';

/**
 * Which couriers business customers see in the shipping portal (13.1 / 13.2): a list per branch, the default of its customers, and a
 * list per customer, which wins. With neither, OCCPL Network only. Company admin; a branch manager for their own branch and customers.
 */
@Component({
  selector: 'app-courier-access-page',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [BranchCourierAccessCard, CustomerCourierAccessCard],
  template: `
    <div class="page">
      <header class="page__head">
        <div>
          <h1 class="text-h1">Courier access</h1>
          <p class="text-caption">Which couriers your business customers see in the shipping portal: the customer's own list, else their home branch's list, else OCCPL Network only.</p>
        </div>
      </header>
      <div class="stack">
        <app-branch-courier-access />
        <app-customer-courier-access />
      </div>
    </div>
  `,
  styles: [`.stack { display:flex; flex-direction:column; gap:16px; }`]
})
export class CourierAccessPage implements OnInit {
  private readonly breadcrumb = inject(BreadcrumbService);
  ngOnInit(): void { this.breadcrumb.set([{ label: 'Business Customer' }, { label: 'Courier access' }]); }
}
