import { ChangeDetectionStrategy, Component, OnInit, computed, inject, input, output, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { RouterLink } from '@angular/router';
import { NotificationService } from '@core/services/notification.service';
import { CustomerResponse } from '@core/models/customer.model';
import { UiCard } from '@shared/components/ui-card/ui-card';
import { UiButton } from '@shared/components/ui-button/ui-button';
import { MasterDataService } from '@features/masters/master-data.service';
import { CourierIntegrationService, CustomerCourierAccess } from '@features/courier-integrations/courier-integration.service';
import { CustomerService } from '../customer.service';

/**
 * A business customer's home branch (13.2) and where their portal couriers come from: their own list, the home branch's, or the default
 * (OCCPL Network only). Filled from the pickup pincode; staff can change it, or blank it to fill it again from the pincode.
 */
@Component({
  selector: 'app-home-branch-card',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, UiCard, UiButton],
  template: `
    <app-card title="Home branch & couriers" subtitle="The branch this customer belongs to. Its couriers are the customer's default in the shipping portal.">
      <div class="hb">
        <label class="hb__pick">Home branch
          <select [value]="branchId()" (change)="branchId.set($any($event.target).value)" aria-label="Home branch">
            <option value="">From the pickup pincode</option>
            @for (b of branches(); track b.id) { <option [value]="b.id">{{ b.label }}</option> }
          </select>
        </label>
        <app-button icon="save" [loading]="saving()" [disabled]="!dirty()" (pressed)="save()">Save</app-button>
      </div>
      @if (!customer().homeBranchId) { <p class="hint">No home branch yet: none serves this customer's pickup pincode. Choose one.</p> }
      @if (access(); as a) {
        <p class="hint">
          Couriers in the portal:
          <strong>{{ enabledNames(a) }}</strong>
          — @switch (a.source) {
            @case ('CUSTOMER') { this customer's own list. }
            @case ('BRANCH') { from the home branch ({{ a.homeBranchName }}). }
            @default { the default (nothing set for the customer or its branch). }
          }
          <a routerLink="/business-customer/courier-access">Change</a>
        </p>
      }
    </app-card>
  `,
  styles: [`
    .hb { display:flex; gap:12px; align-items:flex-end; flex-wrap:wrap; }
    .hb__pick { display:flex; flex-direction:column; gap:4px; font:600 13px var(--font-sans); min-width:260px; flex:1; max-width:420px; }
    .hb__pick select { height:40px; border:1px solid var(--surface-border); border-radius:8px; padding:0 10px; background:var(--surface-card, #fff); color:var(--content-fg); font:400 14px var(--font-sans); }
    .hint { font:400 13px var(--font-sans); color:var(--content-muted); margin:10px 0 0; }
  `]
})
export class HomeBranchCard implements OnInit {
  readonly customer = input.required<CustomerResponse>();
  readonly changed = output<CustomerResponse>();

  private readonly masterData = inject(MasterDataService);
  private readonly customers = inject(CustomerService);
  private readonly couriers = inject(CourierIntegrationService);
  private readonly notify = inject(NotificationService);

  protected readonly branches = signal<{ id: string; label: string }[]>([]);
  protected readonly branchId = signal('');
  protected readonly access = signal<CustomerCourierAccess | null>(null);
  protected readonly saving = signal(false);
  protected readonly dirty = computed(() => this.branchId() !== (this.customer().homeBranchId ?? ''));

  ngOnInit(): void {
    this.branchId.set(this.customer().homeBranchId ?? '');
    this.masterData.branchDirectory().subscribe((list) => this.branches.set(list
      .filter((b) => b.branchType !== 'PICKUP_DELIVERY_PARTNER')
      .map((b) => ({ id: b.id, label: `${b.branchName} (${b.branchCode})` }))
      .sort((a, b) => a.label.localeCompare(b.label))));
    this.loadAccess();
  }

  private loadAccess(): void {
    this.couriers.customerAccess(this.customer().id).subscribe({ next: (a) => this.access.set(a), error: () => this.access.set(null) });
  }

  protected enabledNames(a: CustomerCourierAccess): string {
    return a.couriers.filter((c) => c.enabled).map((c) => c.name).join(', ') || 'none';
  }

  protected save(): void {
    this.saving.set(true);
    this.customers.setHomeBranch(this.customer().id, this.branchId() || null).subscribe({
      next: (c) => {
        this.saving.set(false);
        this.branchId.set(c.homeBranchId ?? '');
        this.changed.emit(c);
        this.loadAccess();
        this.notify.success(c.homeBranchId ? 'Home branch saved.' : 'No branch serves the pickup pincode, so there is no home branch.');
      },
      error: (e: HttpErrorResponse) => { this.saving.set(false); this.notify.error(e.error?.message ?? 'The home branch could not be saved.'); }
    });
  }
}
