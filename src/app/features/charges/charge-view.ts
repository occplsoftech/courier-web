import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { DatePipe, DecimalPipe } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { MatDialog } from '@angular/material/dialog';
import { MatMenuModule } from '@angular/material/menu';
import { MatIconModule } from '@angular/material/icon';
import { BreadcrumbService } from '@core/services/breadcrumb.service';
import { NotificationService } from '@core/services/notification.service';
import { PermissionService } from '@core/auth/permission.service';
import { AppRole } from '@core/models/role.model';
import { ChargeResponse, ChargeSetting } from '@core/models/charge.model';
import { UiCard } from '@shared/components/ui-card/ui-card';
import { UiLoader } from '@shared/components/ui-loader/ui-loader';
import { UiButton } from '@shared/components/ui-button/ui-button';
import { StatusBadge } from '@shared/components/status-badge/status-badge';
import { DialogService } from '@shared/components/ui-dialog/dialog.service';
import { SelectOption } from '@shared/components/ui-select/ui-select';
import { MasterDataService } from '@features/masters/master-data.service';
import { ChargeService } from './charge.service';
import { ChargeSettingFormDialog } from './components/charge-setting-form-dialog';

const WRITERS = [AppRole.COMPANY_ADMIN];

/** View Charge — full read-only detail, the gated action bar, and the Charge Settings
 *  table (add via dialog, edit via dialog, delete/activate/deactivate inline — the same
 *  shape FreightFactorPage's grid already uses). */
@Component({
  selector: 'app-charge-view',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DatePipe, DecimalPipe, MatMenuModule, MatIconModule, UiCard, UiLoader, UiButton, StatusBadge],
  template: `
    @if (loading()) {
      <app-loader [minHeight]="320" caption="Loading…" />
    } @else if (!charge()) {
      <app-card><p class="empty">Charge not found or outside your scope.</p></app-card>
    } @else {
      <header class="cv__banner app-card">
        <div class="cv__id">
          <span class="cv__name">{{ charge()!.chargeName }}</span>
          <app-status-badge [value]="charge()!.status" />
        </div>
        <div class="cv__actions">
          @if (can().update) { <app-button variant="stroked" icon="edit" (pressed)="edit()">Edit</app-button> }
          @if (can().lifecycle || can().delete) {
            <button class="kebab" [matMenuTriggerFor]="menu"><mat-icon>more_vert</mat-icon></button>
            <mat-menu #menu="matMenu">
              @if (can().lifecycle) {
                @if (charge()!.status === 'INACTIVE') {
                  <button mat-menu-item (click)="lifecycle('activate')"><mat-icon>check_circle</mat-icon><span>Activate</span></button>
                } @else {
                  <button mat-menu-item (click)="deactivate()"><mat-icon>block</mat-icon><span>Deactivate</span></button>
                }
              }
              @if (can().delete) {
                <button mat-menu-item (click)="remove()"><mat-icon>delete</mat-icon><span>Delete</span></button>
              }
            </mat-menu>
          }
        </div>
      </header>

      <div class="cv__grid">
        <app-card title="Identity">
          <dl class="kv">
            <dt>Service Type</dt><dd>{{ serviceTypeNames().get(charge()!.serviceTypeId) || charge()!.serviceTypeId }}</dd>
            <dt>Slab Basis</dt><dd>{{ charge()!.isQtyLevel ? 'Average per-piece weight, paid per piece' : 'Total chargeable weight' }}</dd>
            <dt>Status</dt><dd><app-status-badge [value]="charge()!.status" /></dd>
          </dl>
        </app-card>

        <app-card title="Audit">
          <dl class="kv">
            <dt>Created</dt><dd>{{ charge()!.createdDate ? (charge()!.createdDate | date: 'medium') : '—' }}</dd>
            <dt>Last Updated</dt><dd>{{ charge()!.updatedDate ? (charge()!.updatedDate | date: 'medium') : '—' }}</dd>
            <dt>Version</dt><dd>{{ charge()!.version }}</dd>
          </dl>
        </app-card>

        <app-card title="Charge Settings" subtitle="FACTOR (flat/percentage) or SLAB (KG/KM/BOTH banded) rows under this charge.">
          @if (canWriteSettings()) {
            <div card-actions>
              <app-button icon="add" variant="stroked" (pressed)="addSetting()">Add Setting</app-button>
            </div>
          }
          @if (settings().length === 0) {
            <p class="empty">No charge settings yet.</p>
          } @else {
            <table class="tbl">
              <thead>
                <tr>
                  <th>#</th><th>Type</th><th>Slab</th><th>KM Range</th><th>KG Range</th>
                  <th>Charge Value</th><th>Commission</th><th>Status</th>
                  @if (canWriteSettings()) { <th></th> }
                </tr>
              </thead>
              <tbody>
                @for (s of settings(); track s.id; let i = $index) {
                  <tr>
                    <td>{{ i + 1 }}</td>
                    <td>{{ s.chargeType }}</td>
                    <td>{{ s.chargeSlabType || '—' }}</td>
                    <td class="mono">{{ s.fromKm != null ? (s.fromKm + '–' + s.toKm + ' km') : '—' }}</td>
                    <td class="mono">{{ s.fromKg != null ? (s.fromKg + '–' + s.toKg + ' kg') : '—' }}</td>
                    <td class="mono">{{ s.chargeValue | number: '1.2-2' }} {{ s.chargeValueType === 'PERCENTAGE' ? '%' : '' }}</td>
                    <td class="mono">{{ s.commissionValue | number: '1.2-2' }} {{ s.commissionType === 'PERCENTAGE' ? '%' : '' }}</td>
                    <td><app-status-badge [value]="s.status" /></td>
                    @if (canWriteSettings()) {
                      <td class="tbl__actions">
                        <app-button variant="text" icon="edit" [loading]="busySettingId() === s.id" (pressed)="editSetting(s)">Edit</app-button>
                        @if (s.status === 'ACTIVE') {
                          <app-button variant="text" icon="block" [loading]="busySettingId() === s.id" (pressed)="deactivateSetting(s)">Deactivate</app-button>
                        } @else {
                          <app-button variant="text" icon="check_circle" [loading]="busySettingId() === s.id" (pressed)="activateSetting(s)">Activate</app-button>
                        }
                        <app-button variant="text" icon="delete" [loading]="busySettingId() === s.id" (pressed)="deleteSetting(s)">Delete</app-button>
                      </td>
                    }
                  </tr>
                }
              </tbody>
            </table>
          }
        </app-card>
      </div>
    }
  `,
  styles: [`
    .cv__banner { display:flex; align-items:flex-start; justify-content:space-between; gap:16px; padding:20px 24px; margin-bottom:16px; }
    .cv__id { display:flex; flex-direction:column; gap:6px; }
    .cv__name { font:600 21px var(--font-sans); color:var(--content-fg); }
    .cv__actions { display:flex; gap:10px; align-items:center; flex:0 0 auto; }
    .kebab { border:1px solid var(--surface-border); background:var(--surface); cursor:pointer; color:var(--content-muted);
      display:inline-flex; padding:8px; border-radius:8px; }
    .kebab:hover { background:var(--surface-muted); }
    .cv__grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:16px; }
    .cv__grid app-card:last-child { grid-column:1 / -1; }
    .kv { display:grid; grid-template-columns:180px 1fr; gap:10px 16px; margin:0; }
    .kv dt { font:500 16px var(--font-sans); color:var(--content-muted); }
    .kv dd { font:600 17px var(--font-sans); color:var(--content-fg); margin:0; }
    .mono { font-family:var(--font-mono, ui-monospace); }
    .empty { font:400 17px var(--font-sans); color:var(--content-muted); text-align:center; padding:24px; }
    .tbl { width:100%; border-collapse:collapse; font:400 16px var(--font-sans); margin-top:8px; }
    .tbl th { text-align:left; padding:10px 12px; color:var(--content-muted); font-weight:600; border-bottom:1px solid var(--surface-border); }
    .tbl td { padding:10px 12px; border-bottom:1px solid var(--surface-border); }
    .tbl__actions { display:flex; gap:4px; justify-content:flex-end; }
    @media (max-width:860px){ .cv__grid { grid-template-columns:1fr; } }
  `]
})
export class ChargeView implements OnInit {
  private readonly service = inject(ChargeService);
  private readonly masters = inject(MasterDataService);
  private readonly breadcrumb = inject(BreadcrumbService);
  private readonly notify = inject(NotificationService);
  private readonly perms = inject(PermissionService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly confirm = inject(DialogService);
  private readonly dialog = inject(MatDialog);

  readonly loading = signal(true);
  readonly charge = signal<ChargeResponse | null>(null);
  readonly busySettingId = signal<string | null>(null);
  private id = '';

  private readonly serviceTypeOptions = signal<SelectOption[]>([]);
  readonly serviceTypeNames = computed(() => new Map(this.serviceTypeOptions().map((o) => [o.value, o.label])));
  readonly settings = computed<ChargeSetting[]>(() => this.charge()?.settings ?? []);

  readonly can = computed(() => ({
    update: this.perms.canAccess({ roles: WRITERS, permissions: ['CHARGE_UPDATE'] }),
    delete: this.perms.canAccess({ roles: WRITERS, permissions: ['CHARGE_DELETE'] }),
    lifecycle: this.perms.canAccess({ roles: WRITERS, permissions: ['CHARGE_ACTIVATE', 'CHARGE_DEACTIVATE'] })
  }));
  readonly canWriteSettings = computed(() => this.can().update);

  ngOnInit(): void {
    this.id = this.route.snapshot.paramMap.get('id') ?? '';
    this.masters.options('service-types').subscribe((o) => this.serviceTypeOptions.set(o));
    this.load();
  }

  private load(): void {
    this.loading.set(true);
    this.service.get(this.id).subscribe({
      next: (c) => {
        this.charge.set(c);
        this.breadcrumb.set([{ label: 'Charges', route: '/charges' }, { label: c.chargeName }]);
        this.loading.set(false);
      },
      error: () => { this.charge.set(null); this.loading.set(false); }
    });
  }

  private reload(): void { this.service.get(this.id).subscribe((c) => this.charge.set(c)); }

  edit(): void { this.router.navigate(['/charges', this.id, 'edit']); }

  lifecycle(op: 'activate'): void {
    this.service[op](this.id).subscribe({
      next: () => { this.notify.success(`Charge ${op}d.`); this.reload(); },
      error: (e) => this.notify.error(e?.error?.message ?? `Could not ${op} the charge.`)
    });
  }

  deactivate(): void {
    this.confirm.confirm({
      title: 'Deactivate charge',
      message: `"${this.charge()!.chargeName}" will be withdrawn until reactivated.`,
      confirmLabel: 'Deactivate', danger: true
    }).subscribe((ok) => {
      if (!ok) return;
      this.service.deactivate(this.id).subscribe({
        next: () => { this.notify.success('Charge deactivated.'); this.reload(); },
        error: (e) => this.notify.error(e?.error?.message ?? 'Could not deactivate the charge.')
      });
    });
  }

  remove(): void {
    this.confirm.confirm({
      title: 'Delete charge',
      message: `"${this.charge()!.chargeName}" will be removed. This is refused if it still has any charge setting — remove those first.`,
      confirmLabel: 'Delete', danger: true
    }).subscribe((ok) => {
      if (!ok) return;
      this.service.delete(this.id).subscribe({
        next: () => { this.notify.success('Charge deleted.'); this.router.navigate(['/charges']); },
        error: (e) => this.notify.error(e?.error?.message ?? 'Could not delete the charge.')
      });
    });
  }

  // ------------------------------------------------------------- charge settings

  addSetting(): void {
    this.dialog.open(ChargeSettingFormDialog, { data: { chargeId: this.id }, autoFocus: false, panelClass: 'app-dialog' })
      .afterClosed().subscribe((saved: ChargeSetting | null) => { if (saved) this.reload(); });
  }

  editSetting(setting: ChargeSetting): void {
    this.dialog.open(ChargeSettingFormDialog, { data: { chargeId: this.id, setting }, autoFocus: false, panelClass: 'app-dialog' })
      .afterClosed().subscribe((saved: ChargeSetting | null) => { if (saved) this.reload(); });
  }

  activateSetting(setting: ChargeSetting): void {
    this.busySettingId.set(setting.id);
    this.service.activateSetting(this.id, setting.id).subscribe({
      next: () => { this.busySettingId.set(null); this.reload(); },
      error: (e) => { this.busySettingId.set(null); this.notify.error(e?.error?.message ?? 'Could not activate the setting.'); }
    });
  }

  deactivateSetting(setting: ChargeSetting): void {
    this.busySettingId.set(setting.id);
    this.service.deactivateSetting(this.id, setting.id).subscribe({
      next: () => { this.busySettingId.set(null); this.reload(); },
      error: (e) => { this.busySettingId.set(null); this.notify.error(e?.error?.message ?? 'Could not deactivate the setting.'); }
    });
  }

  deleteSetting(setting: ChargeSetting): void {
    this.confirm.confirm({
      title: 'Delete charge setting',
      message: 'This charge setting will be removed.',
      confirmLabel: 'Delete', danger: true
    }).subscribe((ok) => {
      if (!ok) return;
      this.busySettingId.set(setting.id);
      this.service.deleteSetting(this.id, setting.id).subscribe({
        next: () => { this.busySettingId.set(null); this.notify.success('Charge setting deleted.'); this.reload(); },
        error: (e) => { this.busySettingId.set(null); this.notify.error(e?.error?.message ?? 'Could not delete the setting.'); }
      });
    });
  }
}
