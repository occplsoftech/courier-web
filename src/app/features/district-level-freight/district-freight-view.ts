import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { DatePipe, DecimalPipe } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { MatMenuModule } from '@angular/material/menu';
import { MatIconModule } from '@angular/material/icon';
import { BreadcrumbService } from '@core/services/breadcrumb.service';
import { NotificationService } from '@core/services/notification.service';
import { PermissionService } from '@core/auth/permission.service';
import { AppRole } from '@core/models/role.model';
import { DistrictLevelFreight, WEIGHT_SLABS } from '@core/models/district-level-freight.model';
import { UiCard } from '@shared/components/ui-card/ui-card';
import { UiLoader } from '@shared/components/ui-loader/ui-loader';
import { UiButton } from '@shared/components/ui-button/ui-button';
import { StatusBadge } from '@shared/components/status-badge/status-badge';
import { DialogService } from '@shared/components/ui-dialog/dialog.service';
import { DistrictLevelFreightService } from './district-level-freight.service';

const WRITERS = [AppRole.COMPANY_ADMIN];

/** View — full read-only detail plus the gated action bar (Edit / Activate / Deactivate / Delete). */
@Component({
  selector: 'app-district-freight-view',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DatePipe, DecimalPipe, MatMenuModule, MatIconModule, UiCard, UiLoader, UiButton, StatusBadge],
  template: `
    @if (loading()) {
      <app-loader [minHeight]="320" caption="Loading…" />
    } @else if (!row()) {
      <app-card><p class="empty">Rate not found or outside your scope.</p></app-card>
    } @else {
      <header class="rv__banner app-card">
        <div class="rv__id">
          <span class="rv__name">{{ row()!.branchName || row()!.branchCode }} → {{ row()!.districtName || row()!.districtCode }}</span>
          <app-status-badge [value]="row()!.status" />
        </div>
        <div class="rv__actions">
          @if (can().update) { <app-button variant="stroked" icon="edit" (pressed)="edit()">Edit</app-button> }
          @if (can().lifecycle || can().delete) {
            <button class="kebab" [matMenuTriggerFor]="menu"><mat-icon>more_vert</mat-icon></button>
            <mat-menu #menu="matMenu">
              @if (can().lifecycle) {
                @if (row()!.status === 'INACTIVE') {
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

      <div class="rv__grid">
        <app-card title="Route">
          <dl class="kv">
            <dt>From Station</dt><dd>{{ row()!.branchName || '—' }} <span class="mono muted">{{ row()!.branchCode }}</span></dd>
            <dt>District</dt><dd>{{ row()!.districtName || '—' }} <span class="mono muted">{{ row()!.districtCode }}</span></dd>
          </dl>
        </app-card>

        <app-card title="Weight Slab Rates" subtitle="Per-KG. The COMPLETE weight uses exactly one slab's rate.">
          <dl class="kv">
            @for (slab of slabs; track slab.key) {
              <dt>{{ slab.label }}</dt><dd class="mono">{{ rowValue(slab.key) | number: '1.2-2' }}</dd>
            }
          </dl>
        </app-card>

        <app-card title="ODA">
          <dl class="kv">
            <dt>Applicable</dt><dd>{{ row()!.odaApplicable ? 'Yes' : 'No' }}</dd>
            <dt>ODA Charge</dt><dd class="mono">{{ row()!.odaCharge | number: '1.2-2' }}</dd>
          </dl>
        </app-card>

        <app-card title="Audit">
          <dl class="kv">
            <dt>Created</dt><dd>{{ row()!.createdDate ? (row()!.createdDate | date: 'medium') : '—' }}</dd>
            <dt>Last Updated</dt><dd>{{ row()!.updatedDate ? (row()!.updatedDate | date: 'medium') : '—' }}</dd>
            <dt>Version</dt><dd>{{ row()!.version }}</dd>
          </dl>
        </app-card>
      </div>
    }
  `,
  styles: [`
    .rv__banner { display:flex; align-items:flex-start; justify-content:space-between; gap:16px; padding:20px 24px; margin-bottom:16px; }
    .rv__id { display:flex; flex-direction:column; gap:6px; }
    .rv__name { font:600 21px var(--font-sans); color:var(--content-fg); }
    .rv__actions { display:flex; gap:10px; align-items:center; flex:0 0 auto; }
    .kebab { border:1px solid var(--surface-border); background:var(--surface); cursor:pointer; color:var(--content-muted);
      display:inline-flex; padding:8px; border-radius:8px; }
    .kebab:hover { background:var(--surface-muted); }
    .danger { color:var(--danger); }
    .rv__grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:16px; }
    .kv { display:grid; grid-template-columns:180px 1fr; gap:10px 16px; margin:0; }
    .kv dt { font:500 16px var(--font-sans); color:var(--content-muted); }
    .kv dd { font:600 17px var(--font-sans); color:var(--content-fg); margin:0; }
    .mono { font-family:var(--font-mono, ui-monospace); }
    .muted { color:var(--content-muted); font-weight:500; }
    .empty { font:400 17px var(--font-sans); color:var(--content-muted); text-align:center; padding:24px; }
    @media (max-width:860px){ .rv__grid { grid-template-columns:1fr; } }
  `]
})
export class DistrictFreightView implements OnInit {
  private readonly service = inject(DistrictLevelFreightService);
  private readonly breadcrumb = inject(BreadcrumbService);
  private readonly notify = inject(NotificationService);
  private readonly perms = inject(PermissionService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly confirm = inject(DialogService);

  readonly loading = signal(true);
  readonly row = signal<DistrictLevelFreight | null>(null);
  protected readonly slabs = WEIGHT_SLABS;
  private id = '';

  readonly can = computed(() => ({
    update: this.perms.canAccess({ roles: WRITERS }),
    lifecycle: this.perms.canAccess({ roles: WRITERS }),
    delete: this.perms.canAccess({ roles: WRITERS })
  }));

  ngOnInit(): void {
    this.id = this.route.snapshot.paramMap.get('id') ?? '';
    this.load();
  }

  rowValue(key: string): number {
    return (this.row() as unknown as Record<string, number>)[key];
  }

  private load(): void {
    this.loading.set(true);
    this.service.get(this.id).subscribe({
      next: (r) => {
        this.row.set(r);
        this.breadcrumb.set([{ label: 'District Level Freight', route: '/district-level-freight' },
          { label: `${r.branchName ?? r.branchCode} → ${r.districtName ?? r.districtCode}` }]);
        this.loading.set(false);
      },
      error: () => { this.row.set(null); this.loading.set(false); }
    });
  }

  edit(): void { this.router.navigate(['/district-level-freight', this.id, 'edit']); }

  lifecycle(op: 'activate'): void {
    this.service[op](this.id).subscribe({
      next: () => { this.notify.success(`Rate ${op}d.`); this.load(); },
      error: (e) => this.notify.error(e?.error?.message ?? `Could not ${op} the rate.`)
    });
  }

  deactivate(): void {
    this.confirm.confirm({
      title: 'Deactivate rate',
      message: 'This rate will be withdrawn from use until reactivated.',
      confirmLabel: 'Deactivate', danger: true
    }).subscribe((ok) => {
      if (!ok) return;
      this.service.deactivate(this.id).subscribe({
        next: () => { this.notify.success('Rate deactivated.'); this.load(); },
        error: (e) => this.notify.error(e?.error?.message ?? 'Could not deactivate the rate.')
      });
    });
  }

  remove(): void {
    this.confirm.confirm({
      title: 'Delete this rate?',
      message: 'This District Level Freight rate will be removed.',
      confirmLabel: 'Delete', danger: true
    }).subscribe((ok) => {
      if (!ok) return;
      this.service.delete(this.id).subscribe({
        next: () => { this.notify.success('Rate deleted.'); this.router.navigate(['/district-level-freight']); },
        error: (e) => this.notify.error(e?.error?.message ?? 'Could not delete the rate.')
      });
    });
  }
}
