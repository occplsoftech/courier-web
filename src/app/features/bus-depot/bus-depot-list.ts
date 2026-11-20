import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { MatMenuModule } from '@angular/material/menu';
import { MatIconModule } from '@angular/material/icon';
import { BreadcrumbService } from '@core/services/breadcrumb.service';
import { NotificationService } from '@core/services/notification.service';
import { BUS_DEPOT_TYPE_LABEL, BusDepot, BusDepotStatus, BusDepotType } from '@core/models/bus-depot.model';
import { UiButton } from '@shared/components/ui-button/ui-button';
import { UiSearch } from '@shared/components/ui-search/ui-search';
import { UiSelect, SelectOption } from '@shared/components/ui-select/ui-select';
import { UiTable, TableColumn } from '@shared/components/ui-table/ui-table';
import { StatusBadge } from '@shared/components/status-badge/status-badge';
import { DialogService } from '@shared/components/ui-dialog/dialog.service';
import { BusDepotService } from './bus-depot.service';

const STATUS_OPTS: SelectOption[] = [{ value: 'ACTIVE', label: 'Active' }, { value: 'INACTIVE', label: 'Inactive' }];
const TYPE_OPTS: SelectOption[] = [
  { value: 'BUS_DEPOT', label: BUS_DEPOT_TYPE_LABEL.BUS_DEPOT },
  { value: 'BUS_STATION', label: BUS_DEPOT_TYPE_LABEL.BUS_STATION }
];

/** MSRTC bus depots / stations with the branch or vendor each is assigned to. COMPANY_ADMIN-only route. */
@Component({
  selector: 'app-bus-depot-list',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, UiButton, UiSearch, UiSelect, UiTable, StatusBadge, MatMenuModule, MatIconModule],
  template: `
    <div class="page">
      <header class="page__head">
        <div><h1 class="text-h1">Bus Depot / Station</h1>
          <p class="text-caption">MSRTC depots and stations, and the branch or vendor handling each — {{ depots().length }} shown.</p></div>
        <div class="page__actions">
          <app-search placeholder="Search code, name, city…" (changed)="onSearch($event)" />
          <app-button icon="add" (pressed)="create()">New Depot / Station</app-button>
        </div>
      </header>

      <div class="filters">
        <app-select [control]="divisionCtl" label="Division" [options]="divisionOpts()" [allowEmpty]="true" emptyLabel="All divisions" placeholder="All divisions" />
        <app-select [control]="typeCtl" label="Type" [options]="typeOpts" [allowEmpty]="true" emptyLabel="All" placeholder="All" />
        <app-select [control]="statusCtl" label="Status" [options]="statusOpts" [allowEmpty]="true" emptyLabel="All" placeholder="All" />
      </div>

      <app-table [columns]="columns" [rows]="depots()" [loading]="loading()"
                 emptyTitle="No bus depots or stations" emptyHint="Add the MSRTC depots and stations your cargo moves through."
                 (rowClick)="open($event)">
        <ng-template #row let-d>
          <td><div class="nm">{{ d.depotName }}</div><div class="sub">{{ d.depotCode }}</div></td>
          <td>{{ typeLabel(d.depotType) }}</td>
          <td>{{ d.divisionName || '—' }}@if (d.parentDepotName) {<div class="sub">Served by {{ d.parentDepotName }}</div>}</td>
          <td>{{ d.city || '—' }}@if (d.state) {<span class="sub">, {{ d.state }}</span>}</td>
          <td>@if (d.branchName) { {{ d.branchName }} <span class="sub">({{ d.branchCode }})</span> } @else { <span class="sub">Not assigned</span> }</td>
          <td><app-status-badge [value]="d.status" [label]="d.status === 'ACTIVE' ? 'Active' : 'Inactive'" /></td>
          <td class="col-actions" (click)="$event.stopPropagation()">
            <button class="kebab" [matMenuTriggerFor]="menu" aria-label="Actions"><mat-icon>more_vert</mat-icon></button>
            <mat-menu #menu="matMenu">
              <button mat-menu-item (click)="open(d)"><mat-icon>edit</mat-icon><span>Edit / assign</span></button>
              @if (d.status === 'ACTIVE') {
                <button mat-menu-item (click)="setStatus(d, 'deactivate')"><mat-icon>block</mat-icon><span>Deactivate</span></button>
              } @else {
                <button mat-menu-item (click)="setStatus(d, 'activate')"><mat-icon>check_circle</mat-icon><span>Activate</span></button>
              }
              <button mat-menu-item (click)="remove(d)"><mat-icon>delete</mat-icon><span>Delete</span></button>
            </mat-menu>
          </td>
        </ng-template>
      </app-table>
    </div>
  `,
  styles: [`
    .filters { display:grid; grid-template-columns:repeat(3,minmax(0,280px)); gap:16px; margin:0 0 16px; }
    .nm { font:600 17px var(--font-sans); } .sub { font:400 15px var(--font-sans); color:var(--content-muted); }
    .col-actions { text-align:right; width:56px; }
    .kebab { border:0; background:transparent; cursor:pointer; color:var(--content-muted); display:inline-flex; padding:4px; border-radius:8px; }
    .kebab:hover { background:var(--surface-muted); }
    @media (max-width:640px){ .filters { grid-template-columns:1fr; } }
  `]
})
export class BusDepotList implements OnInit {
  private readonly service = inject(BusDepotService);
  private readonly breadcrumb = inject(BreadcrumbService);
  private readonly notify = inject(NotificationService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly confirm = inject(DialogService);

  protected readonly divisionCtl = new FormControl<string>('', { nonNullable: true });
  protected readonly divisionOpts = signal<SelectOption[]>([]);
  protected readonly typeCtl = new FormControl<string>('', { nonNullable: true });
  protected readonly statusCtl = new FormControl<string>('', { nonNullable: true });
  protected readonly typeOpts = TYPE_OPTS;
  protected readonly statusOpts = STATUS_OPTS;
  protected readonly depots = signal<BusDepot[]>([]);
  protected readonly loading = signal(true);
  private search = '';

  protected readonly columns: TableColumn<BusDepot>[] = [
    { key: 'depotName', header: 'Depot / Station' },
    { key: 'depotType', header: 'Type' },
    { key: 'divisionName', header: 'Division' },
    { key: 'city', header: 'Location' },
    { key: 'branchName', header: 'Assigned Branch / Vendor' },
    { key: 'status', header: 'Status', width: '120px' },
    { key: 'actions', header: '', width: '56px', align: 'right' }
  ];

  ngOnInit(): void {
    this.breadcrumb.set([{ label: 'MSRTC' }, { label: 'Bus Depot / Station' }]);
    this.service.divisions().subscribe((d) => this.divisionOpts.set(d.map((x) => ({ value: x.id, label: x.divisionName }))));
    const qp = this.route.snapshot.queryParamMap.get('divisionId');
    if (qp) this.divisionCtl.setValue(qp, { emitEvent: false });
    this.divisionCtl.valueChanges.subscribe(() => this.load());
    this.typeCtl.valueChanges.subscribe(() => this.load());
    this.statusCtl.valueChanges.subscribe(() => this.load());
    this.load();
  }

  private load(): void {
    this.loading.set(true);
    this.service.list({
      divisionId: this.divisionCtl.value || undefined,
      type: (this.typeCtl.value || undefined) as BusDepotType | undefined,
      status: (this.statusCtl.value || undefined) as BusDepotStatus | undefined,
      search: this.search || undefined
    }).subscribe({
      next: (d) => { this.depots.set(d ?? []); this.loading.set(false); },
      error: () => this.loading.set(false)
    });
  }

  protected typeLabel(t: BusDepotType): string { return BUS_DEPOT_TYPE_LABEL[t]; }
  protected onSearch(t: string): void { this.search = t; this.load(); }
  protected create(): void { this.router.navigate(['/msrtc/bus-depots/new']); }
  protected open(d: BusDepot): void { this.router.navigate(['/msrtc/bus-depots', d.id]); }

  protected setStatus(d: BusDepot, op: 'activate' | 'deactivate'): void {
    (op === 'activate' ? this.service.activate(d.id) : this.service.deactivate(d.id)).subscribe({
      next: () => { this.notify.success(`Depot ${op}d.`); this.load(); },
      error: (e) => this.notify.error(e?.error?.message ?? `Could not ${op} the depot.`)
    });
  }

  protected remove(d: BusDepot): void {
    this.confirm.confirm({
      title: 'Delete bus depot / station?',
      message: `"${d.depotName}" will be removed. Past shipments are unaffected.`,
      confirmLabel: 'Delete', danger: true
    }).subscribe((ok) => {
      if (!ok) return;
      this.service.remove(d.id).subscribe({
        next: () => { this.notify.success('Depot deleted.'); this.load(); },
        error: (e) => this.notify.error(e?.error?.message ?? 'Could not delete the depot.')
      });
    });
  }
}
