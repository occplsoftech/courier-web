import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { MatMenuModule } from '@angular/material/menu';
import { MatIconModule } from '@angular/material/icon';
import { BreadcrumbService } from '@core/services/breadcrumb.service';
import { NotificationService } from '@core/services/notification.service';
import { BusCrossingRoute, BusDepotRef, depotRefLabel } from '@core/models/bus-depot.model';
import { UiButton } from '@shared/components/ui-button/ui-button';
import { UiTable, TableColumn } from '@shared/components/ui-table/ui-table';
import { StatusBadge } from '@shared/components/status-badge/status-badge';
import { DialogService } from '@shared/components/ui-dialog/dialog.service';
import { BusDepotService } from './bus-depot.service';

/** Every saved MSRTC crossing route (depot / station to depot / station via crossing points). COMPANY_ADMIN-only route. */
@Component({
  selector: 'app-bus-crossing-list',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [UiButton, UiTable, StatusBadge, MatMenuModule, MatIconModule],
  template: `
    <div class="page">
      <header class="page__head">
        <div><h1 class="text-h1">Crossings</h1>
          <p class="text-caption">Where a bus has no direct service, it goes via crossing points — {{ routes().length }} saved. Booking applies them automatically.</p></div>
        <div class="page__actions">
          <app-button icon="add" (pressed)="create()">New Crossing</app-button>
        </div>
      </header>

      <app-table [columns]="columns" [rows]="routes()" [loading]="loading()"
                 emptyTitle="No crossings yet" emptyHint="Crossings are saved the first time a booking uses one, or add one here."
                 (rowClick)="open($event)">
        <ng-template #row let-r>
          <td><div class="nm">{{ r.from.depotName }}</div><div class="sub">{{ r.from.depotCode }} · {{ typeLabel(r.from) }}</div></td>
          <td><div class="nm">{{ r.to.depotName }}</div><div class="sub">{{ r.to.depotCode }} · {{ typeLabel(r.to) }}</div></td>
          <td>
            @for (s of r.stops; track s.id; let last = $last) {
              <span class="via" [title]="label(s)">{{ s.depotName }}</span>@if (!last) { <span class="sep"> → </span> }
            }
          </td>
          <td><app-status-badge [value]="r.status" [label]="r.status === 'ACTIVE' ? 'Active' : 'Inactive'" /></td>
          <td class="col-actions" (click)="$event.stopPropagation()">
            <button class="kebab" [matMenuTriggerFor]="menu" aria-label="Actions"><mat-icon>more_vert</mat-icon></button>
            <mat-menu #menu="matMenu">
              <button mat-menu-item (click)="open(r)"><mat-icon>edit</mat-icon><span>Edit</span></button>
              @if (r.status === 'ACTIVE') {
                <button mat-menu-item (click)="setStatus(r, 'deactivate')"><mat-icon>block</mat-icon><span>Deactivate</span></button>
              } @else {
                <button mat-menu-item (click)="setStatus(r, 'activate')"><mat-icon>check_circle</mat-icon><span>Activate</span></button>
              }
              <button mat-menu-item (click)="remove(r)"><mat-icon>delete</mat-icon><span>Delete</span></button>
            </mat-menu>
          </td>
        </ng-template>
      </app-table>
    </div>
  `,
  styles: [`
    .nm { font:600 17px var(--font-sans); } .sub { font:400 15px var(--font-sans); color:var(--content-muted); }
    .via { font:500 16px var(--font-sans); } .sep { color:var(--content-muted); }
    .col-actions { text-align:right; width:56px; }
    .kebab { border:0; background:transparent; cursor:pointer; color:var(--content-muted); display:inline-flex; padding:4px; border-radius:8px; }
    .kebab:hover { background:var(--surface-muted); }
  `]
})
export class BusCrossingList implements OnInit {
  private readonly service = inject(BusDepotService);
  private readonly breadcrumb = inject(BreadcrumbService);
  private readonly notify = inject(NotificationService);
  private readonly router = inject(Router);
  private readonly confirm = inject(DialogService);

  protected readonly routes = signal<BusCrossingRoute[]>([]);
  protected readonly loading = signal(true);

  protected readonly columns: TableColumn<BusCrossingRoute>[] = [
    { key: 'from', header: 'From' },
    { key: 'to', header: 'To' },
    { key: 'stops', header: 'Via (crossing points)' },
    { key: 'status', header: 'Status', width: '120px' },
    { key: 'actions', header: '', width: '56px', align: 'right' }
  ];

  ngOnInit(): void {
    this.breadcrumb.set([{ label: 'MSRTC' }, { label: 'Crossings' }]);
    this.load();
  }

  private load(): void {
    this.loading.set(true);
    this.service.crossings().subscribe({
      next: (r) => { this.routes.set(r ?? []); this.loading.set(false); },
      error: () => this.loading.set(false)
    });
  }

  protected label(d: BusDepotRef): string { return depotRefLabel(d); }
  protected typeLabel(d: BusDepotRef): string { return d.depotType === 'BUS_DEPOT' ? 'Depot' : 'Station'; }
  protected create(): void { this.router.navigate(['/msrtc/crossings/new']); }
  protected open(r: BusCrossingRoute): void { this.router.navigate(['/msrtc/crossings', r.id]); }

  protected setStatus(r: BusCrossingRoute, op: 'activate' | 'deactivate'): void {
    (op === 'activate' ? this.service.activateCrossing(r.id) : this.service.deactivateCrossing(r.id)).subscribe({
      next: () => { this.notify.success(`Crossing ${op}d.`); this.load(); },
      error: (e) => this.notify.error(e?.error?.message ?? `Could not ${op} the crossing.`)
    });
  }

  protected remove(r: BusCrossingRoute): void {
    this.confirm.confirm({
      title: 'Delete crossing?', message: `${r.from.depotName} → ${r.to.depotName} will no longer be applied to new bookings. Past shipments keep theirs.`,
      confirmLabel: 'Delete', danger: true
    }).subscribe((ok) => {
      if (!ok) return;
      this.service.removeCrossing(r.id).subscribe({
        next: () => { this.notify.success('Crossing deleted.'); this.load(); },
        error: (e) => this.notify.error(e?.error?.message ?? 'Could not delete the crossing.')
      });
    });
  }
}
