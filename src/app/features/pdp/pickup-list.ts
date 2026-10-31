import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { HttpErrorResponse } from '@angular/common/http';
import { Router } from '@angular/router';
import { Observable, catchError, forkJoin, map, of } from 'rxjs';
import { MatDialog } from '@angular/material/dialog';
import { BreadcrumbService } from '@core/services/breadcrumb.service';
import { NotificationService } from '@core/services/notification.service';
import { AuthService } from '@core/auth/auth.service';
import { PermissionService } from '@core/auth/permission.service';
import { AppRole } from '@core/models/role.model';
import { Page, PageQuery, emptyPage } from '@core/models/page.model';
import { PICKUP_STATUS_LABEL, PickupRequest, PickupStats, PickupStatus } from '@core/models/pdp.model';
import { UiButton } from '@shared/components/ui-button/ui-button';
import { UiSearch } from '@shared/components/ui-search/ui-search';
import { SelectOption } from '@shared/components/ui-select/ui-select';
import { UiTable, TableColumn } from '@shared/components/ui-table/ui-table';
import { UiPagination } from '@shared/components/ui-pagination/ui-pagination';
import { StatusBadge } from '@shared/components/status-badge/status-badge';
import { DialogService } from '@shared/components/ui-dialog/dialog.service';
import { PickupService } from './pickup.service';
import { PdpService } from './pdp.service';
import { PickupAssignDialog, PickupCompleteDialog } from './pickup-dialogs';

/**
 * Pickup requests. Staff (company admin) raise, edit, assign and cancel; the assigned partner
 * accepts / rejects, heads out, records what was collected (or fails the visit), and then books
 * the shipment — the booking screen links the shipment back to the request. A partner login
 * only ever receives its own branch's requests from the server.
 */
@Component({
  selector: 'app-pickup-list',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, UiButton, UiSearch, UiTable, UiPagination, StatusBadge],
  template: `
    <div class="page">
      <header class="page__head">
        <div><h1 class="text-h1">Pickup Requests</h1>
          <p class="text-caption">Collect shipments from customers through Pickup-Delivery Partners.</p></div>
        <div class="page__actions">
          <app-search placeholder="Search no., name, mobile, pincode…" (changed)="onSearch($event)" />
          @if (isAdmin()) { <app-button icon="add" (pressed)="create()">New Pickup</app-button> }
        </div>
      </header>

      @if (stats(); as s) {
        <div class="chips">
          <button type="button" class="chip" [class.on]="!statusCtl.value" (click)="setStatus('')">All <b>{{ total(s) }}</b></button>
          @for (st of statuses; track st) {
            <button type="button" class="chip" [class.on]="statusCtl.value === st" (click)="setStatus(st)">
              {{ label(st) }} <b>{{ s.byStatus[st] ?? 0 }}</b></button>
          }
        </div>
      }

      <app-table [columns]="columns" [rows]="page().content" [loading]="loading()" [startIndex]="page().page * page().size"
                 emptyTitle="No pickup requests" emptyHint="Create a pickup request to get started." idKey="id">
        <ng-template #row let-p>
          <td><strong>{{ p.pickupNo }}</strong><div class="text-caption">{{ day(p.createdDate) }}</div></td>
          <td><div class="cs">{{ p.contactName }}</div><div class="text-caption">{{ p.contactMobile }}</div></td>
          <td>{{ p.addressLine }}<div class="text-caption">{{ p.city || '' }} {{ p.pincode }}</div></td>
          <td>{{ p.actualWeightKg ?? p.expectedWeightKg ?? '—' }}<div class="text-caption">{{ p.actualParcels ?? p.expectedParcels }} parcel(s)</div></td>
          <td>{{ p.bookingBranchName || '—' }}<div class="text-caption">{{ p.bookingBranchCode || '' }}</div></td>
          <td>{{ p.pdpBranchName || '—' }}<div class="text-caption">{{ p.pdpBranchCode || '' }}</div></td>
          <td><app-status-badge [value]="p.status" [label]="label(p.status)" />
            @if (p.shipmentNo) { <div class="text-caption">{{ p.shipmentNo }}</div> }
            @if (p.status === 'REQUESTED' && p.rejectReason) { <div class="text-caption warn">Rejected: {{ p.rejectReason }}</div> }
            @if (p.status === 'FAILED') { <div class="text-caption warn">{{ p.failReason }}</div> }</td>
          <td class="col-actions">
            @if (canRoute(p) && (p.status === 'REQUESTED' || p.status === 'ASSIGNED' || p.status === 'ACCEPTED')) {
              <app-button variant="stroked" icon="person_add" (pressed)="assign(p)">{{ p.pdpBranchId ? 'Reassign' : 'Assign' }}</app-button>
            }
            @if (mine(p)) {
              @if (p.status === 'ASSIGNED') {
                <app-button icon="check" (pressed)="accept(p)">Accept</app-button>
                <app-button variant="stroked" icon="close" (pressed)="reject(p)">Reject</app-button>
              }
              @if (p.status === 'ACCEPTED') { <app-button icon="directions_run" (pressed)="start(p)">Start</app-button> }
              @if (p.status === 'OUT_FOR_PICKUP') {
                <app-button icon="inventory_2" (pressed)="complete(p)">Collected</app-button>
                <app-button variant="stroked" icon="report" (pressed)="fail(p)">Failed</app-button>
              }
              @if (p.status === 'PICKED_UP') { <app-button icon="local_shipping" (pressed)="book(p)">Book shipment</app-button> }
            }
            @if (isAdmin() && (p.status === 'REQUESTED' || p.status === 'ASSIGNED')) {
              <app-button variant="stroked" icon="edit" (pressed)="edit(p)">Edit</app-button>
            }
            @if (isAdmin() && p.status !== 'PICKED_UP' && p.status !== 'BOOKED' && p.status !== 'FAILED' && p.status !== 'CANCELLED' && p.status !== 'OUT_FOR_PICKUP') {
              <app-button variant="stroked" icon="block" (pressed)="cancel(p)">Cancel</app-button>
            }
          </td>
        </ng-template>
      </app-table>
      <app-pagination [page]="page()" (pageChange)="onPage($event)" />
    </div>
  `,
  styles: [`
    .chips { display:flex; flex-wrap:wrap; gap:8px; margin:0 0 16px; }
    .chip { border:1px solid var(--surface-border); background:transparent; border-radius:999px; padding:6px 12px; font:500 13px var(--font-sans); cursor:pointer; color:var(--content-fg); }
    .chip b { margin-left:4px; } .chip.on { background:var(--primary, #1a56db); color:#fff; border-color:transparent; }
    .cs { font:600 14px var(--font-sans); } .warn { color:var(--danger); }
    .col-actions { text-align:right; white-space:nowrap; } .col-actions app-button { margin-left:6px; }
  `]
})
export class PickupList implements OnInit {
  private readonly svc = inject(PickupService);
  private readonly pdp = inject(PdpService);
  private readonly breadcrumb = inject(BreadcrumbService);
  private readonly notify = inject(NotificationService);
  private readonly auth = inject(AuthService);
  private readonly perms = inject(PermissionService);
  private readonly dialogs = inject(DialogService);
  private readonly matDialog = inject(MatDialog);
  private readonly router = inject(Router);

  protected readonly statusCtl = new FormControl<string>('', { nonNullable: true });
  protected readonly page = signal<Page<PickupRequest>>(emptyPage());
  protected readonly stats = signal<PickupStats | null>(null);
  protected readonly loading = signal(true);
  protected readonly partnerOpts = signal<SelectOption[]>([]);
  protected readonly isAdmin = computed(() => this.perms.hasRole(AppRole.COMPANY_ADMIN));
  protected readonly statuses: PickupStatus[] = ['REQUESTED', 'ASSIGNED', 'ACCEPTED', 'OUT_FOR_PICKUP', 'PICKED_UP', 'BOOKED', 'FAILED', 'CANCELLED'];
  private query: PageQuery = { page: 0, size: 20 };

  protected readonly columns: TableColumn<PickupRequest>[] = [
    { key: 'pickupNo', header: 'Pickup' },
    { key: 'contact', header: 'Contact' },
    { key: 'address', header: 'Address' },
    { key: 'weight', header: 'Weight' },
    { key: 'branch', header: 'Branch' },
    { key: 'partner', header: 'Partner' },
    { key: 'status', header: 'Status', width: '150px' },
    { key: 'actions', header: '', align: 'right' }
  ];

  ngOnInit(): void {
    this.breadcrumb.set([{ label: 'Pickup Delivery Partner Management' }, { label: 'Pickup Requests' }]);
    this.load();
  }

  protected label(s: PickupStatus): string { return PICKUP_STATUS_LABEL[s]; }
  protected total(s: PickupStats): number { return Object.values(s.byStatus).reduce((a, b) => a + b, 0); }
  /** A partner works only requests assigned to their own branch; an admin may work any. */
  protected mine(p: PickupRequest): boolean {
    return this.isAdmin() || (!!p.pdpBranchId && p.pdpBranchId === this.auth.user()?.branchId);
  }

  /** The admin, or the manager of the branch this pickup belongs to, assigns it to a pickup partner. */
  protected canRoute(p: PickupRequest): boolean {
    return this.isAdmin() || (!!p.bookingBranchId && p.bookingBranchId === this.auth.user()?.branchId);
  }

  private load(): void {
    this.loading.set(true);
    this.svc.list({ ...this.query, status: (this.statusCtl.value || undefined) as PickupStatus | undefined }).subscribe({
      next: (p) => { this.page.set(p); this.loading.set(false); },
      error: () => this.loading.set(false)
    });
    this.svc.stats().subscribe((s) => this.stats.set(s));
  }

  protected setStatus(s: string): void { this.statusCtl.setValue(s); this.query = { ...this.query, page: 0 }; this.load(); }
  protected onSearch(t: string): void { this.query = { ...this.query, search: t || undefined, page: 0 }; this.load(); }
  protected onPage(i: number): void { this.query = { ...this.query, page: i }; this.load(); }
  protected create(): void { this.router.navigate(['/pdp/pickups/new']); }
  protected edit(p: PickupRequest): void { this.router.navigate(['/pdp/pickups', p.id]); }

  protected day(iso?: string | null): string { return iso ? iso.slice(0, 10) : ''; }
  protected accept(p: PickupRequest): void { this.run(this.svc.accept(p.id), 'Pickup accepted.'); }
  protected start(p: PickupRequest): void { this.run(this.svc.start(p.id), 'Out for pickup.'); }
  protected reject(p: PickupRequest): void { this.withReason(p, 'Reject pickup', 'Reject', (r) => this.svc.reject(p.id, r), 'Pickup rejected.'); }
  protected fail(p: PickupRequest): void { this.withReason(p, 'Pickup failed', 'Mark failed', (r) => this.svc.fail(p.id, r), 'Pickup marked failed.'); }
  protected cancel(p: PickupRequest): void { this.withReason(p, 'Cancel pickup', 'Cancel pickup', (r) => this.svc.cancel(p.id, r), 'Pickup cancelled.'); }

  protected run(call: Observable<PickupRequest>, ok: string): void {
    call.subscribe({
      next: () => { this.notify.success(ok); this.load(); },
      error: (e: HttpErrorResponse) => this.notify.error(e.error?.message ?? 'Action failed.')
    });
  }

  protected withReason(p: PickupRequest, title: string, confirmLabel: string, call: (reason: string) => Observable<PickupRequest>, ok: string): void {
    this.dialogs.prompt({ title, message: `${p.pickupNo} — ${p.contactName}`, label: 'Reason', confirmLabel, danger: true, maxLength: 255 })
      .subscribe((reason) => { if (reason) this.run(call(reason), ok); });
  }

  protected assign(p: PickupRequest): void {
    const open = (opts: SelectOption[], suggested?: string) => this.matDialog
      .open(PickupAssignDialog, { data: { pickup: p, partners: opts, suggested }, autoFocus: false, panelClass: 'app-dialog' })
      .afterClosed().subscribe((id: string | undefined) => { if (id) this.run(this.svc.assign(p.id, id), 'Pickup assigned.'); });
    const suggestion$ = this.svc.suggestedPartner(p.id).pipe(catchError(() => of(undefined)));
    const partners$ = this.partnerOpts().length ? of(this.partnerOpts()) : this.svc.assignablePartners().pipe(
      map((list) => list.map((b) => ({ value: b.id, label: `${b.name} (${b.code})` }))),
      catchError(() => { this.notify.error('The pickup partners could not be loaded.'); return of([] as SelectOption[]); }));
    forkJoin({ opts: partners$, suggested: suggestion$ }).subscribe(({ opts, suggested }) => {
      this.partnerOpts.set(opts);
      open(opts, suggested ?? undefined);
    });
  }

  protected complete(p: PickupRequest): void {
    this.matDialog.open(PickupCompleteDialog, { data: { pickup: p }, autoFocus: false, panelClass: 'app-dialog' })
      .afterClosed().subscribe((v: { parcels: number; weight: number } | undefined) => {
        if (v) this.run(this.svc.complete(p.id, v.parcels, v.weight), 'Pickup collected.');
      });
  }

  protected book(p: PickupRequest): void {
    this.router.navigate(['/shipments/new'], { queryParams: {
      pickupId: p.id, pincode: p.pincode, name: p.contactName, mobile: p.contactMobile, address: p.addressLine,
      weight: p.actualWeightKg ?? undefined, parcels: p.actualParcels ?? undefined
    } });
  }
}
