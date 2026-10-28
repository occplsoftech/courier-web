import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { MatMenuModule } from '@angular/material/menu';
import { MatIconModule } from '@angular/material/icon';
import { BreadcrumbService } from '@core/services/breadcrumb.service';
import { NotificationService } from '@core/services/notification.service';
import { PermissionService } from '@core/auth/permission.service';
import { AppRole } from '@core/models/role.model';
import { TariffZone, TariffZoneStatus, ZONE_USAGE_LABELS, ZoneResolution, ZoneUsage } from '@core/models/zone-tariff.model';
import { UiButton } from '@shared/components/ui-button/ui-button';
import { UiCard } from '@shared/components/ui-card/ui-card';
import { UiInput } from '@shared/components/ui-input/ui-input';
import { UiSearch } from '@shared/components/ui-search/ui-search';
import { UiSelect, SelectOption } from '@shared/components/ui-select/ui-select';
import { UiTable, TableColumn } from '@shared/components/ui-table/ui-table';
import { StatusBadge } from '@shared/components/status-badge/status-badge';
import { DialogService } from '@shared/components/ui-dialog/dialog.service';
import { ZoneTariffService } from './zone-tariff.service';

const USAGE_OPTS: SelectOption[] = (Object.keys(ZONE_USAGE_LABELS) as ZoneUsage[]).map((u) => ({ value: u, label: ZONE_USAGE_LABELS[u] }));
const STATUS_OPTS: SelectOption[] = [{ value: 'ACTIVE', label: 'Active' }, { value: 'INACTIVE', label: 'Inactive' }];
const DIRECTION_OPTS: SelectOption[] = [{ value: 'TO', label: 'Delivered here (to)' }, { value: 'FROM', label: 'Starts here (from)' }];

/**
 * The company's tariff zones (PUNE, METRO, KERALA…) — filter by usage and status, search by code or name, and test
 * which zone a pincode falls in. The most specific location wins: pincode, city, district, state.
 */
@Component({
  selector: 'app-tariff-zone-list',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, UiButton, UiCard, UiInput, UiSearch, UiSelect, UiTable, StatusBadge, MatMenuModule, MatIconModule],
  template: `
    <div class="page">
      <header class="page__head">
        <div><h1 class="text-h1">Tariff Zones</h1>
          <p class="text-caption">Groups of states, districts, cities and pincodes your rate cards price by — {{ zones().length }} shown.</p></div>
        <div class="page__actions">
          <app-search placeholder="Search code or name…" (changed)="onSearch($event)" />
          @if (canCreate()) { <app-button icon="add" (pressed)="create()">New Zone</app-button> }
        </div>
      </header>

      <app-card title="Which zone is this pincode in?" subtitle="Uses the active zones. A pincode, city or district entry beats its state.">
        <div class="test">
          <app-input [control]="testPinCtl" label="Pincode" placeholder="e.g. 411030" [maxLength]="6" />
          <app-select [control]="testDirCtl" label="Direction" [options]="directionOpts" />
          <app-button icon="travel_explore" [loading]="testing()" [disabled]="testPinCtl.value.length !== 6" (pressed)="test()">Find zone</app-button>
        </div>
        @if (testResult(); as r) {
          <p class="answer">
            @if (r.zone) {
              <strong>{{ r.pincode }}</strong> is in <strong>{{ r.zone.code }}</strong> ({{ r.zone.name }}), matched by {{ r.matchedBy?.label }}.
            } @else {
              No active {{ r.direction === 'FROM' ? 'from' : 'to' }} zone covers <strong>{{ r.pincode }}</strong>@if (r.place) { ({{ r.place.label }}) }.
            }
          </p>
        }
      </app-card>

      <div class="filters">
        <app-select [control]="usageCtl" label="Usage" [options]="usageOpts" [allowEmpty]="true" emptyLabel="All" placeholder="All" />
        <app-select [control]="statusCtl" label="Status" [options]="statusOpts" [allowEmpty]="true" emptyLabel="All" placeholder="All" />
      </div>

      <app-table [columns]="columns" [rows]="zones()" [loading]="loading()"
                 emptyTitle="No tariff zones" emptyHint="Create zones such as PUNE, METRO or KERALA, then rate cards priced by them."
                 (rowClick)="open($event)">
        <ng-template #row let-z>
          <td><div class="zn">{{ z.code }}</div><div class="sub">{{ z.name }}</div></td>
          <td>{{ usageLabel(z.usage) }}</td>
          <td>{{ z.locationCount }}</td>
          <td><app-status-badge [value]="z.status" [label]="z.status === 'ACTIVE' ? 'Active' : 'Inactive'" /></td>
          <td class="col-actions" (click)="$event.stopPropagation()">
            <button class="kebab" [matMenuTriggerFor]="menu" aria-label="Actions"><mat-icon>more_vert</mat-icon></button>
            <mat-menu #menu="matMenu">
              <button mat-menu-item (click)="open(z)"><mat-icon>edit_location</mat-icon><span>Manage zone</span></button>
              @if (canUpdate()) {
                @if (z.status === 'ACTIVE') {
                  <button mat-menu-item (click)="setStatus(z, 'deactivate')"><mat-icon>block</mat-icon><span>Deactivate</span></button>
                } @else {
                  <button mat-menu-item (click)="setStatus(z, 'activate')"><mat-icon>check_circle</mat-icon><span>Activate</span></button>
                }
              }
              @if (canDelete()) {
                <button mat-menu-item (click)="remove(z)"><mat-icon>delete</mat-icon><span>Delete</span></button>
              }
            </mat-menu>
          </td>
        </ng-template>
      </app-table>
    </div>
  `,
  styles: [`
    .test { display:grid; grid-template-columns:minmax(0,200px) minmax(0,240px) auto; gap:12px 16px; align-items:end; }
    .answer { font:400 14px var(--font-sans); margin:12px 0 0; }
    .filters { display:grid; grid-template-columns:repeat(2,minmax(0,280px)); gap:16px; margin:16px 0; }
    .zn { font:600 14px var(--font-sans); } .sub { font:400 12px var(--font-sans); color:var(--content-muted); }
    .col-actions { text-align:right; width:56px; }
    .kebab { border:0; background:transparent; cursor:pointer; color:var(--content-muted); display:inline-flex; padding:4px; border-radius:8px; }
    .kebab:hover { background:var(--surface-muted); }
    @media (max-width:640px){ .filters, .test { grid-template-columns:1fr; } }
  `]
})
export class TariffZoneList implements OnInit {
  private readonly service = inject(ZoneTariffService);
  private readonly breadcrumb = inject(BreadcrumbService);
  private readonly notify = inject(NotificationService);
  private readonly perms = inject(PermissionService);
  private readonly router = inject(Router);
  private readonly confirm = inject(DialogService);

  protected readonly usageCtl = new FormControl<string>('', { nonNullable: true });
  protected readonly statusCtl = new FormControl<string>('', { nonNullable: true });
  protected readonly testPinCtl = new FormControl<string>('', { nonNullable: true });
  protected readonly testDirCtl = new FormControl<string>('TO', { nonNullable: true });
  protected readonly usageOpts = USAGE_OPTS;
  protected readonly statusOpts = STATUS_OPTS;
  protected readonly directionOpts = DIRECTION_OPTS;
  protected readonly zones = signal<TariffZone[]>([]);
  protected readonly loading = signal(true);
  protected readonly testing = signal(false);
  protected readonly testResult = signal<ZoneResolution | null>(null);
  private search = '';

  protected readonly columns: TableColumn<TariffZone>[] = [
    { key: 'code', header: 'Zone' },
    { key: 'usage', header: 'Usage' },
    { key: 'locationCount', header: 'Locations', width: '120px' },
    { key: 'status', header: 'Status', width: '120px' },
    { key: 'actions', header: '', width: '56px', align: 'right' }
  ];

  protected readonly canCreate = computed(() => this.perms.canAccess({ roles: [AppRole.COMPANY_ADMIN], permissions: ['TARIFF_CREATE'] }));
  protected readonly canUpdate = computed(() => this.perms.canAccess({ roles: [AppRole.COMPANY_ADMIN], permissions: ['TARIFF_UPDATE'] }));
  protected readonly canDelete = computed(() => this.perms.canAccess({ roles: [AppRole.COMPANY_ADMIN], permissions: ['TARIFF_DELETE'] }));

  ngOnInit(): void {
    this.breadcrumb.set([{ label: 'Zone Tariff' }, { label: 'Zones' }]);
    this.usageCtl.valueChanges.subscribe(() => this.load());
    this.statusCtl.valueChanges.subscribe(() => this.load());
    this.load();
  }

  private load(): void {
    this.loading.set(true);
    this.service.zones({
      usage: (this.usageCtl.value || undefined) as ZoneUsage | undefined,
      status: (this.statusCtl.value || undefined) as TariffZoneStatus | undefined,
      search: this.search || undefined
    }).subscribe({
      next: (z) => { this.zones.set(z ?? []); this.loading.set(false); },
      error: () => this.loading.set(false)
    });
  }

  usageLabel(u: ZoneUsage): string { return u === 'BOTH' ? 'From and to' : u === 'FROM' ? 'From' : 'To'; }
  onSearch(t: string): void { this.search = t; this.load(); }
  create(): void { this.router.navigate(['/zone-tariff/zones/new']); }
  open(z: TariffZone): void { this.router.navigate(['/zone-tariff/zones', z.id]); }

  test(): void {
    this.testing.set(true);
    this.service.resolve(this.testPinCtl.value.trim(), this.testDirCtl.value as 'FROM' | 'TO').subscribe({
      next: (r) => { this.testResult.set(r); this.testing.set(false); },
      error: (e: HttpErrorResponse) => { this.testing.set(false); this.testResult.set(null); this.notify.error(e.error?.message ?? 'Could not look the pincode up.'); }
    });
  }

  setStatus(z: TariffZone, op: 'activate' | 'deactivate'): void {
    (op === 'activate' ? this.service.activateZone(z.id) : this.service.deactivateZone(z.id)).subscribe({
      next: () => { this.notify.success(`Zone ${op}d.`); this.load(); },
      error: (e: HttpErrorResponse) => this.notify.error(e.error?.message ?? `Could not ${op} the zone.`)
    });
  }

  remove(z: TariffZone): void {
    this.confirm.confirm({
      title: 'Delete tariff zone?',
      message: `"${z.code}" and its locations will be removed. A zone a rate card uses cannot be deleted — deactivate it instead.`,
      confirmLabel: 'Delete', danger: true
    }).subscribe((ok) => {
      if (!ok) return;
      this.service.deleteZone(z.id).subscribe({
        next: () => { this.notify.success('Zone deleted.'); this.load(); },
        error: (e: HttpErrorResponse) => this.notify.error(e.error?.message ?? 'Could not delete the zone.')
      });
    });
  }
}
