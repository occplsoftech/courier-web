import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { forkJoin } from 'rxjs';
import { MatMenuModule } from '@angular/material/menu';
import { MatIconModule } from '@angular/material/icon';
import { MatDialog } from '@angular/material/dialog';
import { BreadcrumbService } from '@core/services/breadcrumb.service';
import { NotificationService } from '@core/services/notification.service';
import { PermissionService } from '@core/auth/permission.service';
import { AppRole } from '@core/models/role.model';
import { BranchResponse } from '@core/models/branch.model';
import { UiCard } from '@shared/components/ui-card/ui-card';
import { UiLoader } from '@shared/components/ui-loader/ui-loader';
import { UiButton } from '@shared/components/ui-button/ui-button';
import { DialogService } from '@shared/components/ui-dialog/dialog.service';
import { BranchSummaryCard } from './components/branch-summary-card';
import { AssignManagerDialog } from './components/assign-manager-dialog';
import { BranchService, Lookup } from './branch.service';

const UPDATERS = [AppRole.COMPANY_ADMIN, AppRole.BRANCH_MANAGER];
const WRITERS = [AppRole.COMPANY_ADMIN];

/** View Branch — full read-only profile plus the gated action bar (edit, lifecycle, assign, delete). */
@Component({
  selector: 'app-branch-view',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DatePipe, MatMenuModule, MatIconModule, UiCard, UiLoader, UiButton, BranchSummaryCard],
  template: `
    <div class="page">
      @if (loading()) {
        <app-loader [minHeight]="320" caption="Loading…" />
      } @else if (!branch()) {
        <app-card><p class="empty">Branch not found or outside your scope.</p></app-card>
      } @else {
        <header class="bv__banner app-card">
          <app-branch-summary-card [branch]="branch()!" [managerName]="managerName()" />
          <div class="bv__actions">
            <app-button variant="stroked" icon="support_agent" (pressed)="raiseTicket()">Raise Ticket</app-button>
            @if (can().update) { <app-button variant="stroked" icon="edit" (pressed)="edit()">Edit</app-button> }
            @if (hasMenu()) {
              <button class="kebab" [matMenuTriggerFor]="menu"><mat-icon>more_vert</mat-icon></button>
              <mat-menu #menu="matMenu">
                @if (can().update) {
                  <button mat-menu-item (click)="assignManager()"><mat-icon>person_pin</mat-icon><span>Assign Manager</span></button>
                  @if (branch()!.status === 'INACTIVE') {
                    <button mat-menu-item (click)="lifecycle('activate')"><mat-icon>check_circle</mat-icon><span>Activate</span></button>
                  } @else {
                    <button mat-menu-item (click)="deactivate()"><mat-icon>block</mat-icon><span>Deactivate</span></button>
                  }
                }
                @if (can().delete) {
                  <button mat-menu-item class="danger" (click)="remove()"><mat-icon>delete</mat-icon><span>Delete</span></button>
                }
              </mat-menu>
            }
          </div>
        </header>

        <div class="bv__grid">
          <app-card title="Contact">
            <dl class="kv">
              <dt>Email</dt><dd>{{ branch()!.email || '—' }}</dd>
              <dt>Mobile</dt><dd>{{ branch()!.mobile || '—' }}</dd>
              <dt>Alternate Mobile</dt><dd>{{ branch()!.alternateMobile || '—' }}</dd>
              <dt>Manager</dt><dd>{{ managerName() }}</dd>
            </dl>
          </app-card>

          <app-card title="Address">
            <dl class="kv">
              <dt>Address Line 1</dt><dd>{{ branch()!.addressLine1 || '—' }}</dd>
              <dt>Address Line 2</dt><dd>{{ branch()!.addressLine2 || '—' }}</dd>
              <dt>City</dt><dd>{{ branch()!.city || '—' }}</dd>
              <dt>Area / District</dt><dd>{{ branch()!.district || '—' }}</dd>
              <dt>Taluka</dt><dd>{{ branch()!.taluka || '—' }}</dd>
              <dt>State</dt><dd>{{ branch()!.state || '—' }}</dd>
              <dt>Country</dt><dd>{{ branch()!.country || '—' }}</dd>
              <dt>Pincode</dt><dd>{{ branch()!.postalCode || '—' }}</dd>
              <dt>Latitude</dt><dd>{{ branch()!.latitude ?? '—' }}</dd>
              <dt>Longitude</dt><dd>{{ branch()!.longitude ?? '—' }}</dd>
            </dl>
          </app-card>

          <app-card title="Charges" subtitle="Percentages applied to shipment charges booked at this branch.">
            <dl class="kv">
              <dt>GST Number</dt><dd class="mono">{{ branch()!.gstNumber || '—' }}</dd>
              <dt>PAN Number</dt><dd class="mono">{{ branch()!.panNumber || '—' }}</dd>
              <dt>GST %</dt><dd>{{ branch()!.gstPercentage }}%</dd>
              <dt>Company Commission on Other Charges %</dt><dd>{{ branch()!.commissionOnOtherCharges }}%</dd>
              <dt>Commission on Basic Freight %</dt><dd>{{ branch()!.commissionOnBasicFreight }}%</dd>
              <dt>Company Service Charge %</dt><dd>{{ branch()!.companyServiceChargePercentage }}%</dd>
              <dt>DRS Charge per Qty</dt><dd>{{ branch()!.drsChargePerQty }}</dd>
              <dt>Delivery Commission per Kg</dt><dd>{{ branch()!.deliveryCommissionRatePerKg }}</dd>
              <dt>Delivery Commission Minimum Chargeable Weight (Kg)</dt><dd>{{ branch()!.deliveryCommissionMinWeightKg }}</dd>
            </dl>
          </app-card>

          <app-card title="Operations" subtitle="Enabled capabilities and working hours.">
            <div class="caps">
              <span class="cap" [class.cap--on]="branch()!.allowBooking">Booking</span>
              <span class="cap" [class.cap--on]="branch()!.allowDelivery">Delivery</span>
              <span class="cap" [class.cap--on]="branch()!.allowPickup">Pickup</span>
              <span class="cap" [class.cap--on]="branch()!.allowManifest">Manifest</span>
              <span class="cap" [class.cap--on]="branch()!.allowCashCollection">Cash Collection</span>
              <span class="cap" [class.cap--on]="branch()!.allowWallet">Wallet</span>
              <span class="cap" [class.cap--on]="branch()!.instantCommission">Instant Commission</span>
            </div>
            <dl class="kv kv--tight">
              <dt>Opening</dt><dd>{{ time(branch()!.openingTime) }}</dd>
              <dt>Closing</dt><dd>{{ time(branch()!.closingTime) }}</dd>
              <dt>Working Days</dt><dd>{{ branch()!.workingDays || '—' }}</dd>
            </dl>
          </app-card>

          @if (isAdmin()) {
            <app-card title="Courier pickup location" subtitle="Used when this branch forwards a shipment to Delhivery or Shiprocket.">
              <p class="bv__hint">Type the pickup location name exactly as it is registered in the courier's panel. Without it, this branch cannot forward to Delhivery or Shiprocket.</p>
              <div class="bv__pl">
                <input class="bv__input" type="text" maxlength="120" placeholder="e.g. PUNE-HUB" [value]="pickupName()"
                  (input)="pickupName.set($any($event.target).value)" aria-label="Courier pickup location name" />
                <app-button [loading]="pickupSaving()" [disabled]="pickupName().trim() === (branch()!.courierPickupLocation ?? '')"
                  (pressed)="savePickup()">Save</app-button>
              </div>
            </app-card>
          }

          <app-card title="Audit">
            <dl class="kv">
              <dt>Branch Code</dt><dd class="mono">{{ branch()!.branchCode }}</dd>
              <dt>Created</dt><dd>{{ branch()!.createdDate ? (branch()!.createdDate | date:'medium') : '—' }}</dd>
              <dt>Created By</dt><dd class="mono">{{ branch()!.createdBy || '—' }}</dd>
              <dt>Last Updated</dt><dd>{{ branch()!.updatedDate ? (branch()!.updatedDate | date:'medium') : '—' }}</dd>
              <dt>Updated By</dt><dd class="mono">{{ branch()!.updatedBy || '—' }}</dd>
              <dt>Version</dt><dd>{{ branch()!.version }}</dd>
              <dt>Remarks</dt><dd>{{ branch()!.remarks || '—' }}</dd>
            </dl>
          </app-card>
        </div>
      }
    </div>
  `,
  styles: [`
    .bv__hint { margin:0 0 10px; font:400 13px var(--font-sans); color:var(--content-muted); }
    .bv__pl { display:flex; gap:10px; align-items:center; flex-wrap:wrap; }
    .bv__input { flex:1; min-width:220px; padding:10px 12px; border:1px solid var(--surface-border); border-radius:var(--r-field);
      background:var(--surface); color:var(--content-fg); font:400 14px var(--font-sans); }
    .bv__banner { display:flex; align-items:flex-start; justify-content:space-between; gap:16px; padding:20px 24px; margin-bottom:16px; }
    .bv__actions { display:flex; gap:10px; align-items:center; flex:0 0 auto; }
    .kebab { border:1px solid var(--surface-border); background:var(--surface); cursor:pointer; color:var(--content-muted);
      display:inline-flex; padding:8px; border-radius:8px; }
    .kebab:hover { background:var(--surface-muted); }
    .danger { color:var(--danger); }
    .bv__grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:16px; }
    .kv { display:grid; grid-template-columns:160px 1fr; gap:10px 16px; margin:0; }
    .kv--tight { margin-top:14px; }
    .kv dt { font:500 13px var(--font-sans); color:var(--content-muted); }
    .kv dd { font:600 14px var(--font-sans); color:var(--content-fg); margin:0; }
    .mono { font-family:var(--font-mono, ui-monospace); }
    .caps { display:flex; flex-wrap:wrap; gap:6px; }
    .cap { font:600 11px var(--font-sans); padding:3px 10px; border-radius:999px; background:var(--surface-muted);
      color:var(--content-muted); border:1px solid var(--surface-border); }
    .cap--on { background:var(--success-bg); color:var(--success); border-color:transparent; }
    .empty { font:400 14px var(--font-sans); color:var(--content-muted); text-align:center; padding:24px; }
    @media (max-width:860px){ .bv__grid { grid-template-columns:1fr; } }
  `]
})
export class BranchView implements OnInit {
  private readonly service = inject(BranchService);
  private readonly breadcrumb = inject(BreadcrumbService);
  private readonly notify = inject(NotificationService);
  private readonly perms = inject(PermissionService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly confirm = inject(DialogService);
  private readonly dialog = inject(MatDialog);

  readonly loading = signal(true);
  readonly branch = signal<BranchResponse | null>(null);
  private readonly managers = signal<Lookup[]>([]);
  private id = '';

  readonly can = computed(() => ({
    update: this.perms.canAccess({ roles: UPDATERS, permissions: ['BRANCH_UPDATE'] }),
    delete: this.perms.canAccess({ roles: WRITERS, permissions: ['BRANCH_DELETE'] })
  }));
  readonly isAdmin = computed(() => this.perms.canAccess({ roles: WRITERS }));
  readonly pickupName = signal('');
  readonly pickupSaving = signal(false);
  readonly hasMenu = computed(() => { const c = this.can(); return c.update || c.delete; });

  readonly managerName = computed(() => {
    const id = this.branch()?.managerId;
    if (!id) return 'Unassigned';
    return this.managers().find((m) => m.id === id)?.label ?? '—';
  });

  ngOnInit(): void {
    this.id = this.route.snapshot.paramMap.get('id') ?? '';
    this.loading.set(true);
    forkJoin({ branch: this.service.get(this.id), managers: this.service.managers() }).subscribe({
      next: (l) => {
        this.branch.set(l.branch); this.managers.set(l.managers); this.pickupName.set(l.branch.courierPickupLocation ?? '');
        this.breadcrumb.set([{ label: 'Branches', route: '/branches' }, { label: l.branch.branchName }]);
        this.loading.set(false);
      },
      error: () => { this.branch.set(null); this.loading.set(false); }
    });
  }

  private reload(): void { this.service.get(this.id).subscribe((b) => this.branch.set(b)); }

  savePickup(): void {
    this.pickupSaving.set(true);
    this.service.setCourierPickupLocation(this.id, this.pickupName().trim()).subscribe({
      next: (b) => { this.pickupSaving.set(false); this.branch.set(b); this.pickupName.set(b.courierPickupLocation ?? ''); this.notify.success('Pickup location saved.'); },
      error: () => this.pickupSaving.set(false)
    });
  }

  time(t?: string | null): string { return t ? t.slice(0, 5) : '—'; }

  edit(): void { this.router.navigate(['/branches', this.id, 'edit']); }

  raiseTicket(): void { this.router.navigate(['/support/tickets/new'], { queryParams: { branchId: this.id } }); }

  lifecycle(op: 'activate'): void {
    this.service[op](this.id).subscribe({
      next: () => { this.notify.success(`Branch ${op}d.`); this.reload(); },
      error: (e) => this.notify.error(e?.error?.message ?? `Could not ${op} the branch.`)
    });
  }

  deactivate(): void {
    this.confirm.confirm({
      title: 'Deactivate branch',
      message: `"${this.branch()!.branchName}" will stop accepting operations until reactivated.`,
      confirmLabel: 'Deactivate', danger: true
    }).subscribe((ok) => {
      if (!ok) return;
      this.service.deactivate(this.id).subscribe({
        next: () => { this.notify.success('Branch deactivated.'); this.reload(); },
        error: (e) => this.notify.error(e?.error?.message ?? 'Could not deactivate the branch.')
      });
    });
  }

  assignManager(): void {
    this.dialog.open(AssignManagerDialog, {
      autoFocus: false, panelClass: 'app-dialog',
      data: { branchId: this.id, branchName: this.branch()!.branchName, currentId: this.branch()!.managerId ?? null, options: this.managers() }
    }).afterClosed().subscribe((updated: BranchResponse | null) => { if (updated) this.branch.set(updated); });
  }

  remove(): void {
    this.confirm.confirm({
      title: 'Delete branch',
      message: `"${this.branch()!.branchName}" will be removed. Its code stays reserved and cannot be reused.`,
      confirmLabel: 'Delete', danger: true
    }).subscribe((ok) => {
      if (!ok) return;
      this.service.remove(this.id).subscribe({
        next: () => { this.notify.success('Branch deleted.'); this.router.navigate(['/branches']); },
        error: (e) => this.notify.error(e?.error?.message ?? 'Could not delete the branch.')
      });
    });
  }
}
