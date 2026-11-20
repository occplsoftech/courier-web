import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { DatePipe } from '@angular/common';
import { map } from 'rxjs/operators';
import { BreadcrumbService } from '@core/services/breadcrumb.service';
import { NotificationService } from '@core/services/notification.service';
import { AppRole } from '@core/models/role.model';
import { PermissionService } from '@core/auth/permission.service';
import { MasterRecord } from '@core/models/master.model';
import { UiButton } from '@shared/components/ui-button/ui-button';
import { UiCard } from '@shared/components/ui-card/ui-card';
import { UiLoader } from '@shared/components/ui-loader/ui-loader';
import { StatusBadge } from '@shared/components/status-badge/status-badge';
import { DialogService } from '@shared/components/ui-dialog/dialog.service';
import { PincodeAreasCard } from './components/pincode-areas-card';
import { MasterDataService } from './master-data.service';
import {
  MASTER_PERMISSIONS, MASTER_WRITERS, MasterDefinition, writeAccessFor, readAccessFor, MasterField, findMaster
} from './master.config';

/**
 * The detail view for every master list.
 *
 * Fields are read back from the same definition the form writes with, grouped the same
 * way, so what a user filled in is what they see — including the fields the list table has
 * no room for.
 *
 * A `lookup` field shows the resolved parent name the backend sent (`countryName`,
 * `areaName`, `bookingBranchName`), never the raw id. When the backend could not resolve
 * it the name is null, and this shows a dash rather than inventing one.
 */
@Component({
  selector: 'app-master-view',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DatePipe, UiButton, UiCard, UiLoader, StatusBadge, PincodeAreasCard],
  template: `
    @if (def(); as d) {
      <div class="page">
        @if (loading()) {
          <app-loader [minHeight]="320" caption="Loading…" />
        } @else if (record(); as r) {
          <header class="page__head">
            <div class="mv__title">
              <h1 class="text-h1">{{ r.name }}</h1>
              <span class="mv__code">{{ r.code }}</span>
              <app-status-badge [value]="r.status" />
            </div>
            <div class="page__actions">
              <app-button variant="stroked" icon="arrow_back" (pressed)="back()">Back</app-button>
              @if (can().update) {
                <app-button variant="stroked" icon="edit" (pressed)="edit()">Edit</app-button>
                @if (r.status === 'INACTIVE') {
                  <app-button variant="stroked" icon="check_circle" (pressed)="lifecycle('activate')">Activate</app-button>
                } @else {
                  <app-button variant="stroked" icon="block" (pressed)="lifecycle('deactivate')">Deactivate</app-button>
                }
              }
              @if (can().delete) {
                <app-button variant="danger" icon="delete" (pressed)="remove()">Delete</app-button>
              }
            </div>
          </header>

          @for (group of groups(); track group.name) {
            <app-card [title]="group.name">
              <dl class="mv__grid">
                @for (field of group.fields; track field.key) {
                  <div class="mv__item">
                    <dt>{{ field.label }}</dt>
                    <dd>{{ display(field, r) }}</dd>
                  </div>
                }
              </dl>
            </app-card>
          }

          @if (d.key === 'pincodes') {
            <app-pincode-areas-card [pincodeId]="r.id" [canWrite]="canEditAreas()" />
          }

          <app-card title="Audit">
            <dl class="mv__grid">
              <div class="mv__item"><dt>Created</dt>
                <dd>{{ r.createdDate ? (r.createdDate | date: 'medium') : '—' }}</dd></div>
              <div class="mv__item"><dt>Last updated</dt>
                <dd>{{ r.updatedDate ? (r.updatedDate | date: 'medium') : '—' }}</dd></div>
              <div class="mv__item"><dt>Version</dt><dd>{{ r.version }}</dd></div>
            </dl>
          </app-card>
        }
      </div>
    }
  `,
  styles: [`
    .mv__title { display:flex; align-items:center; gap:12px; flex-wrap:wrap; }
    .mv__code { font:600 16px var(--font-mono, ui-monospace); color:var(--content-muted);
      background:var(--surface-muted); border-radius:6px; padding:3px 8px; }
    .mv__grid { display:grid; grid-template-columns:repeat(auto-fit, minmax(220px, 1fr)); gap:18px; margin:0; }
    .mv__item dt { font:500 15px var(--font-sans); color:var(--content-muted);
      text-transform:uppercase; letter-spacing:.04em; margin-bottom:4px; }
    .mv__item dd { font:400 17px var(--font-sans); color:var(--content-fg); margin:0; }
  `]
})
export class MasterView {
  private readonly service = inject(MasterDataService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly breadcrumb = inject(BreadcrumbService);
  private readonly notify = inject(NotificationService);
  private readonly perms = inject(PermissionService);
  private readonly confirm = inject(DialogService);

  readonly def = toSignal(
    this.route.paramMap.pipe(map((p) => findMaster(p.get('master')))),
    { initialValue: null as MasterDefinition | null }
  );
  private readonly id = toSignal(
    this.route.paramMap.pipe(map((p) => p.get('id'))),
    { initialValue: null as string | null }
  );

  readonly loading = signal(true);
  readonly record = signal<MasterRecord | null>(null);

  // See master-list: the writer tier comes from the definition, not a constant.
  readonly can = computed(() => {
    const def = this.def();
    const access = def ? writeAccessFor(def) : { roles: MASTER_WRITERS, permissions: MASTER_PERMISSIONS };
    return {
      update: this.perms.canAccess({ roles: access.roles, permissions: access.permissions.update }),
      delete: this.perms.canAccess({ roles: access.roles, permissions: access.permissions.delete })
    };
  });

  /**
   * The per-area switches (Serviceable, ODA): a company admin may change them as the server allows (PincodeAreaService), even
   * without the platform's GLOBAL_MASTER_UPDATE that editing the pincode itself needs.
   */
  readonly canEditAreas = computed(() => this.can().update || this.perms.hasRole(AppRole.COMPANY_ADMIN)
    || this.perms.hasRole(AppRole.SUPER_ADMIN));

  /**
   * Pincode's own `areaId` is skipped here — the "Areas served by this pincode" card
   * below already shows it (with a Primary badge, city and ODA), a plain "Placement"
   * card would just repeat it. A group left with zero fields is dropped, not shown empty.
   */
  readonly groups = computed(() => {
    const def = this.def();
    if (!def) return [];
    const ordered: { name: string; fields: MasterField[] }[] = [];
    for (const field of def.fields) {
      if (def.key === 'pincodes' && field.key === 'areaId') continue;
      const name = field.group ?? 'Details';
      const existing = ordered.find((g) => g.name === name);
      if (existing) existing.fields.push(field);
      else ordered.push({ name, fields: [field] });
    }
    return ordered;
  });

  constructor() {
    effect(() => {
      const def = this.def();
      const id = this.id();
      if (!def || !id) {
        this.router.navigate(['/masters/countries']);
        return;
      }
      const access = readAccessFor(def);
      if (!this.perms.canAccess({ roles: access.roles, permissions: access.permissions.view })) {
        this.router.navigate(['/unauthorized']);
        return;
      }
      this.breadcrumb.set([
        { label: 'Masters' },
        { label: def.plural, route: `/masters/${def.key}` },
        { label: 'Details' }
      ]);
      this.fetch(def, id);
    });
  }

  private fetch(def: MasterDefinition, id: string): void {
    this.loading.set(true);
    this.service.get(def, id).subscribe({
      next: (row) => { this.record.set(row); this.loading.set(false); },
      error: (e) => {
        this.loading.set(false);
        this.notify.error(e?.error?.message ?? `Could not load the ${def.singular.toLowerCase()}.`);
        this.router.navigate(['/masters', def.key]);
      }
    });
  }

  /** A lookup renders its resolved name; a boolean reads Yes/No; anything empty is a dash. */
  display(field: MasterField, row: MasterRecord): string {
    if (field.kind === 'lookup') {
      const nameKey = field.key.replace(/Id$/, 'Name');
      const name = row[nameKey];
      return name ? String(name) : '—';
    }
    const value = row[field.key];
    if (field.kind === 'boolean') return value ? 'Yes' : 'No';
    return value === null || value === undefined || value === '' ? '—' : String(value);
  }

  back(): void {
    this.router.navigate(['/masters', this.def()!.key]);
  }

  edit(): void {
    this.router.navigate(['/masters', this.def()!.key, this.id(), 'edit']);
  }

  lifecycle(operation: 'activate' | 'deactivate'): void {
    const def = this.def()!;
    this.service[operation](def, this.id()!).subscribe({
      next: (row) => { this.record.set(row); this.notify.success(`${def.singular} ${operation}d.`); },
      error: (e) => this.notify.error(e?.error?.message ?? `Could not ${operation} the ${def.singular.toLowerCase()}.`)
    });
  }

  remove(): void {
    const def = this.def()!;
    const row = this.record();
    this.confirm.confirm({
      title: `Delete ${def.singular.toLowerCase()}`,
      message: `"${row?.name}" will be removed. Its code stays reserved and cannot be reused.`,
      confirmLabel: 'Delete', danger: true
    }).subscribe((ok) => {
      if (!ok) return;
      this.service.remove(def, this.id()!).subscribe({
        next: () => { this.notify.success(`${def.singular} deleted.`); this.back(); },
        error: (e) => this.notify.error(e?.error?.message ?? `Could not delete the ${def.singular.toLowerCase()}.`)
      });
    });
  }
}
