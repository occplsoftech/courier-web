import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { MatMenuModule } from '@angular/material/menu';
import { MatIconModule } from '@angular/material/icon';
import { BreadcrumbService } from '@core/services/breadcrumb.service';
import { NotificationService } from '@core/services/notification.service';
import { PermissionService } from '@core/auth/permission.service';
import { AppRole } from '@core/models/role.model';
import { RateCard, TariffStatus } from '@core/models/zone-tariff.model';
import { UiButton } from '@shared/components/ui-button/ui-button';
import { UiSearch } from '@shared/components/ui-search/ui-search';
import { UiSelect, SelectOption } from '@shared/components/ui-select/ui-select';
import { UiTable, TableColumn } from '@shared/components/ui-table/ui-table';
import { StatusBadge } from '@shared/components/status-badge/status-badge';
import { DialogService } from '@shared/components/ui-dialog/dialog.service';
import { ZoneTariffService } from './zone-tariff.service';

const STATUS_OPTS: SelectOption[] = [{ value: 'ACTIVE', label: 'Active' }, { value: 'INACTIVE', label: 'Inactive' }];

/** Rate cards of the zone tariff — one per from zone and period. Filter by from zone and status. */
@Component({
  selector: 'app-rate-card-list',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, DatePipe, UiButton, UiSearch, UiSelect, UiTable, StatusBadge, MatMenuModule, MatIconModule],
  template: `
    <div class="page">
      <header class="page__head">
        <div><h1 class="text-h1">Rate Cards</h1>
          <p class="text-caption">Prices from one from zone, by to zone, service type, package type and weight — {{ cards().length }} shown.</p></div>
        <div class="page__actions">
          <app-search placeholder="Search code or name…" (changed)="onSearch($event)" />
          @if (canCreate()) { <app-button icon="add" (pressed)="create()">New Rate Card</app-button> }
        </div>
      </header>

      <div class="filters">
        <app-select [control]="zoneCtl" label="From zone" [options]="zoneOpts()" [allowEmpty]="true" emptyLabel="All" placeholder="All" />
        <app-select [control]="statusCtl" label="Status" [options]="statusOpts" [allowEmpty]="true" emptyLabel="All" placeholder="All" />
      </div>

      <app-table [columns]="columns" [rows]="cards()" [loading]="loading()"
                 emptyTitle="No rate cards" emptyHint="Create a rate card for a from zone, add its rates, then activate it."
                 (rowClick)="open($event)">
        <ng-template #row let-c>
          <td><div class="zn">{{ c.code }}</div><div class="sub">{{ c.name }}</div></td>
          <td>{{ c.fromZoneCode || '—' }}</td>
          <td>{{ c.effectiveFrom | date: 'dd MMM yyyy' }} – {{ c.effectiveTo ? (c.effectiveTo | date: 'dd MMM yyyy') : 'open' }}</td>
          <td>{{ c.laneCount }} lanes · {{ c.chargeCount }} charges</td>
          <td><app-status-badge [value]="c.status" [label]="c.status === 'ACTIVE' ? 'Active' : 'Inactive'" /></td>
          <td class="col-actions" (click)="$event.stopPropagation()">
            <button class="kebab" [matMenuTriggerFor]="menu" aria-label="Actions"><mat-icon>more_vert</mat-icon></button>
            <mat-menu #menu="matMenu">
              <button mat-menu-item (click)="open(c)"><mat-icon>request_quote</mat-icon><span>Open</span></button>
              @if (canUpdate()) {
                @if (c.status === 'ACTIVE') {
                  <button mat-menu-item (click)="setStatus(c, 'deactivate')"><mat-icon>block</mat-icon><span>Deactivate</span></button>
                } @else {
                  <button mat-menu-item (click)="setStatus(c, 'activate')"><mat-icon>check_circle</mat-icon><span>Activate</span></button>
                }
              }
              @if (canDelete()) {
                <button mat-menu-item (click)="remove(c)"><mat-icon>delete</mat-icon><span>Delete</span></button>
              }
            </mat-menu>
          </td>
        </ng-template>
      </app-table>
    </div>
  `,
  styles: [`
    .filters { display:grid; grid-template-columns:repeat(2,minmax(0,280px)); gap:16px; margin:0 0 16px; }
    .zn { font:600 14px var(--font-sans); } .sub { font:400 12px var(--font-sans); color:var(--content-muted); }
    .col-actions { text-align:right; width:56px; }
    .kebab { border:0; background:transparent; cursor:pointer; color:var(--content-muted); display:inline-flex; padding:4px; border-radius:8px; }
    .kebab:hover { background:var(--surface-muted); }
    @media (max-width:640px){ .filters { grid-template-columns:1fr; } }
  `]
})
export class RateCardList implements OnInit {
  private readonly service = inject(ZoneTariffService);
  private readonly breadcrumb = inject(BreadcrumbService);
  private readonly notify = inject(NotificationService);
  private readonly perms = inject(PermissionService);
  private readonly router = inject(Router);
  private readonly confirm = inject(DialogService);

  protected readonly zoneCtl = new FormControl<string>('', { nonNullable: true });
  protected readonly statusCtl = new FormControl<string>('', { nonNullable: true });
  protected readonly statusOpts = STATUS_OPTS;
  protected readonly zoneOpts = signal<SelectOption[]>([]);
  protected readonly cards = signal<RateCard[]>([]);
  protected readonly loading = signal(true);
  private search = '';

  protected readonly columns: TableColumn<RateCard>[] = [
    { key: 'code', header: 'Rate card' },
    { key: 'fromZoneCode', header: 'From zone' },
    { key: 'effectiveFrom', header: 'Valid' },
    { key: 'laneCount', header: 'Rates' },
    { key: 'status', header: 'Status', width: '120px' },
    { key: 'actions', header: '', width: '56px', align: 'right' }
  ];

  protected readonly canCreate = computed(() => this.perms.canAccess({ roles: [AppRole.COMPANY_ADMIN], permissions: ['TARIFF_CREATE'] }));
  protected readonly canUpdate = computed(() => this.perms.canAccess({ roles: [AppRole.COMPANY_ADMIN], permissions: ['TARIFF_UPDATE'] }));
  protected readonly canDelete = computed(() => this.perms.canAccess({ roles: [AppRole.COMPANY_ADMIN], permissions: ['TARIFF_DELETE'] }));

  ngOnInit(): void {
    this.breadcrumb.set([{ label: 'Zone Tariff' }, { label: 'Rate Cards' }]);
    this.service.zones().subscribe((zs) => this.zoneOpts.set(zs.filter((z) => z.usage !== 'TO')
      .map((z) => ({ value: z.id, label: `${z.code} — ${z.name}` }))));
    this.zoneCtl.valueChanges.subscribe(() => this.load());
    this.statusCtl.valueChanges.subscribe(() => this.load());
    this.load();
  }

  private load(): void {
    this.loading.set(true);
    this.service.cards({
      fromZoneId: this.zoneCtl.value || undefined,
      status: (this.statusCtl.value || undefined) as TariffStatus | undefined,
      search: this.search || undefined
    }).subscribe({
      next: (c) => { this.cards.set(c ?? []); this.loading.set(false); },
      error: () => this.loading.set(false)
    });
  }

  onSearch(t: string): void { this.search = t; this.load(); }
  create(): void { this.router.navigate(['/zone-tariff/rate-cards/new']); }
  open(c: RateCard): void { this.router.navigate(['/zone-tariff/rate-cards', c.id]); }

  setStatus(c: RateCard, op: 'activate' | 'deactivate'): void {
    (op === 'activate' ? this.service.activateCard(c.id) : this.service.deactivateCard(c.id)).subscribe({
      next: () => { this.notify.success(`Rate card ${op}d.`); this.load(); },
      error: (e: HttpErrorResponse) => this.notify.error(e.error?.message ?? `Could not ${op} the rate card.`)
    });
  }

  remove(c: RateCard): void {
    this.confirm.confirm({
      title: 'Delete rate card?',
      message: `"${c.code}" with all its rates and charges will be removed. Past bookings are unaffected.`,
      confirmLabel: 'Delete', danger: true
    }).subscribe((ok) => {
      if (!ok) return;
      this.service.deleteCard(c.id).subscribe({
        next: () => { this.notify.success('Rate card deleted.'); this.load(); },
        error: (e: HttpErrorResponse) => this.notify.error(e.error?.message ?? 'Could not delete the rate card.')
      });
    });
  }
}
