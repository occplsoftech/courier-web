import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { MatMenuModule } from '@angular/material/menu';
import { MatIconModule } from '@angular/material/icon';
import { BreadcrumbService } from '@core/services/breadcrumb.service';
import { NotificationService } from '@core/services/notification.service';
import { BusDivision } from '@core/models/bus-depot.model';
import { UiButton } from '@shared/components/ui-button/ui-button';
import { UiSearch } from '@shared/components/ui-search/ui-search';
import { UiTable, TableColumn } from '@shared/components/ui-table/ui-table';
import { StatusBadge } from '@shared/components/status-badge/status-badge';
import { DialogService } from '@shared/components/ui-dialog/dialog.service';
import { BusDepotService } from './bus-depot.service';

/** MSRTC divisions with how many depots and stations sit under each. COMPANY_ADMIN-only route. */
@Component({
  selector: 'app-bus-division-list',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [UiButton, UiSearch, UiTable, StatusBadge, MatMenuModule, MatIconModule],
  template: `
    <div class="page">
      <header class="page__head">
        <div><h1 class="text-h1">Divisions</h1>
          <p class="text-caption">MSRTC divisions — each groups its depots and bus stations — {{ divisions().length }} shown.</p></div>
        <div class="page__actions">
          <app-search placeholder="Search division…" (changed)="onSearch($event)" />
          <app-button icon="add" (pressed)="create()">New Division</app-button>
        </div>
      </header>

      <app-table [columns]="columns" [rows]="divisions()" [loading]="loading()"
                 emptyTitle="No divisions" emptyHint="Add the MSRTC divisions, then place depots and stations in them."
                 (rowClick)="open($event)">
        <ng-template #row let-v>
          <td><div class="nm">{{ v.divisionName }}</div><div class="sub">{{ v.divisionCode }}</div></td>
          <td>{{ v.depotCount }}</td>
          <td>{{ v.stationCount }}</td>
          <td><app-status-badge [value]="v.status" [label]="v.status === 'ACTIVE' ? 'Active' : 'Inactive'" /></td>
          <td class="col-actions" (click)="$event.stopPropagation()">
            <button class="kebab" [matMenuTriggerFor]="menu" aria-label="Actions"><mat-icon>more_vert</mat-icon></button>
            <mat-menu #menu="matMenu">
              <button mat-menu-item (click)="open(v)"><mat-icon>edit</mat-icon><span>Edit</span></button>
              <button mat-menu-item (click)="viewDepots(v)"><mat-icon>warehouse</mat-icon><span>View depots / stations</span></button>
              @if (v.status === 'ACTIVE') {
                <button mat-menu-item (click)="setStatus(v, 'deactivate')"><mat-icon>block</mat-icon><span>Deactivate</span></button>
              } @else {
                <button mat-menu-item (click)="setStatus(v, 'activate')"><mat-icon>check_circle</mat-icon><span>Activate</span></button>
              }
              <button mat-menu-item (click)="remove(v)"><mat-icon>delete</mat-icon><span>Delete</span></button>
            </mat-menu>
          </td>
        </ng-template>
      </app-table>
    </div>
  `,
  styles: [`
    .nm { font:600 17px var(--font-sans); } .sub { font:400 15px var(--font-sans); color:var(--content-muted); }
    .col-actions { text-align:right; width:56px; }
    .kebab { border:0; background:transparent; cursor:pointer; color:var(--content-muted); display:inline-flex; padding:4px; border-radius:8px; }
    .kebab:hover { background:var(--surface-muted); }
  `]
})
export class BusDivisionList implements OnInit {
  private readonly service = inject(BusDepotService);
  private readonly breadcrumb = inject(BreadcrumbService);
  private readonly notify = inject(NotificationService);
  private readonly router = inject(Router);
  private readonly confirm = inject(DialogService);

  protected readonly divisions = signal<BusDivision[]>([]);
  protected readonly loading = signal(true);
  private search = '';

  protected readonly columns: TableColumn<BusDivision>[] = [
    { key: 'divisionName', header: 'Division' },
    { key: 'depotCount', header: 'Depots', width: '100px' },
    { key: 'stationCount', header: 'Stations', width: '100px' },
    { key: 'status', header: 'Status', width: '120px' },
    { key: 'actions', header: '', width: '56px', align: 'right' }
  ];

  ngOnInit(): void {
    this.breadcrumb.set([{ label: 'MSRTC' }, { label: 'Divisions' }]);
    this.load();
  }

  private load(): void {
    this.loading.set(true);
    this.service.divisions({ search: this.search || undefined }).subscribe({
      next: (d) => { this.divisions.set(d ?? []); this.loading.set(false); },
      error: () => this.loading.set(false)
    });
  }

  protected onSearch(t: string): void { this.search = t; this.load(); }
  protected create(): void { this.router.navigate(['/msrtc/divisions/new']); }
  protected open(v: BusDivision): void { this.router.navigate(['/msrtc/divisions', v.id]); }
  protected viewDepots(v: BusDivision): void { this.router.navigate(['/msrtc/bus-depots'], { queryParams: { divisionId: v.id } }); }

  protected setStatus(v: BusDivision, op: 'activate' | 'deactivate'): void {
    (op === 'activate' ? this.service.activateDivision(v.id) : this.service.deactivateDivision(v.id)).subscribe({
      next: () => { this.notify.success(`Division ${op}d.`); this.load(); },
      error: (e) => this.notify.error(e?.error?.message ?? `Could not ${op} the division.`)
    });
  }

  protected remove(v: BusDivision): void {
    this.confirm.confirm({
      title: 'Delete division?', message: `"${v.divisionName}" will be removed. A division that still has depots or stations cannot be deleted.`,
      confirmLabel: 'Delete', danger: true
    }).subscribe((ok) => {
      if (!ok) return;
      this.service.removeDivision(v.id).subscribe({
        next: () => { this.notify.success('Division deleted.'); this.load(); },
        error: (e) => this.notify.error(e?.error?.message ?? 'Could not delete the division.')
      });
    });
  }
}
