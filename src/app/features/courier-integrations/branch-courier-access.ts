import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { NotificationService } from '@core/services/notification.service';
import { AuthService } from '@core/auth/auth.service';
import { UiCard } from '@shared/components/ui-card/ui-card';
import { UiButton } from '@shared/components/ui-button/ui-button';
import { MasterDataService } from '@features/masters/master-data.service';
import { apiMessage } from '@features/communication/api-error';
import { BranchCourierAccess, CourierIntegrationService } from './courier-integration.service';

/**
 * A branch's couriers (13.2): the default for every business customer whose home branch it is and who has no list of their own. With
 * none ticked those customers see OCCPL Network only. A branch manager sees their own branch only.
 */
@Component({
  selector: 'app-branch-courier-access',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [UiCard, UiButton],
  template: `
    <app-card title="Branch couriers" subtitle="The couriers a branch gives its customers. A customer with a list of their own (below) uses that instead.">
      <div class="ca">
        @if (ownBranchId) {
          <p class="hint">Your branch: <strong>{{ branchName(ownBranchId) }}</strong></p>
        } @else {
          <label class="ca__pick">Branch
            <select [value]="branchId()" (change)="choose($any($event.target).value)" aria-label="Branch">
              <option value="">Select a branch…</option>
              @for (b of branches(); track b.id) { <option [value]="b.id">{{ b.label }}</option> }
            </select>
          </label>
        }

        @if (loading()) { <p class="hint" role="status">Loading…</p> }
        @if (error()) { <p class="alert" role="alert">{{ error() }}</p> }

        @if (access(); as a) {
          <p class="hint">
            {{ a.customers }} business customer{{ a.customers === 1 ? '' : 's' }} {{ a.customers === 1 ? 'has' : 'have' }} this home branch.
            @if (a.customised) { Those without a list of their own see the ticked couriers. }
            @else { Nothing is set for this branch, so they see <strong>OCCPL Network only</strong>. }
          </p>
          <ul class="ca__list">
            @for (o of a.couriers; track o.code) {
              <li>
                <label>
                  <input type="checkbox" [checked]="picked().has(o.code)" (change)="toggle(o.code)" />
                  <span class="ca__name">{{ o.name }}</span>
                  @if (!o.connected) { <span class="ca__off">not connected</span> }
                </label>
              </li>
            }
          </ul>
          <div class="ca__bar">
            <span class="hint">{{ picked().size === 0 ? 'None ticked: back to OCCPL Network only.' : picked().size + ' courier(s) ticked.' }}</span>
            <app-button icon="save" [loading]="saving()" [disabled]="!dirty()" (pressed)="save()">Save</app-button>
          </div>
        }
      </div>
    </app-card>
  `,
  styles: [`
    .ca { display:flex; flex-direction:column; gap:12px; }
    .ca__pick { display:flex; flex-direction:column; gap:4px; font:600 13px var(--font-sans); max-width:420px; }
    .ca__pick select { height:40px; border:1px solid var(--surface-border); border-radius:8px; padding:0 10px; background:var(--surface-card, #fff); color:var(--content-fg); font:400 14px var(--font-sans); }
    .ca__list { list-style:none; margin:0; padding:0; display:grid; grid-template-columns:repeat(auto-fill, minmax(240px, 1fr)); gap:8px; }
    .ca__list label { display:flex; align-items:center; gap:10px; padding:10px 12px; border:1px solid var(--surface-border); border-radius:10px; cursor:pointer; }
    .ca__list input { width:1.05rem; height:1.05rem; }
    .ca__name { font:600 14px var(--font-sans); }
    .ca__off { margin-left:auto; font:500 11px var(--font-sans); color:var(--content-muted); }
    .ca__bar { display:flex; justify-content:space-between; align-items:center; gap:12px; flex-wrap:wrap; }
    .hint { font:400 13px var(--font-sans); color:var(--content-muted); margin:0; }
    .alert { color:var(--danger, #b3123a); font:500 13px var(--font-sans); margin:0; }
  `]
})
export class BranchCourierAccessCard implements OnInit {
  private readonly svc = inject(CourierIntegrationService);
  private readonly masterData = inject(MasterDataService);
  private readonly notify = inject(NotificationService);
  private readonly auth = inject(AuthService);

  /** A branch manager manages their own branch only; a company admin picks any branch. */
  protected readonly ownBranchId: string | null = this.auth.hasAnyRole(['COMPANY_ADMIN']) ? null : (this.auth.user()?.branchId ?? null);
  protected readonly branches = signal<{ id: string; label: string }[]>([]);
  protected readonly branchId = signal('');
  protected readonly access = signal<BranchCourierAccess | null>(null);
  protected readonly picked = signal<ReadonlySet<string>>(new Set());
  protected readonly loading = signal(false);
  protected readonly saving = signal(false);
  protected readonly error = signal<string | null>(null);
  private saved = new Set<string>();

  protected readonly dirty = computed(() => {
    const now = this.picked();
    return now.size !== this.saved.size || [...now].some((c) => !this.saved.has(c));
  });

  ngOnInit(): void {
    this.masterData.branchDirectory().subscribe((list) => this.branches.set(list
      .filter((b) => b.branchType !== 'PICKUP_DELIVERY_PARTNER')
      .map((b) => ({ id: b.id, label: `${b.branchName} (${b.branchCode})` }))
      .sort((a, b) => a.label.localeCompare(b.label))));
    if (this.ownBranchId) this.choose(this.ownBranchId);
  }

  protected branchName(id: string): string { return this.branches().find((b) => b.id === id)?.label ?? 'your branch'; }

  protected choose(id: string): void {
    this.branchId.set(id);
    this.access.set(null);
    this.error.set(null);
    if (!id) return;
    this.loading.set(true);
    this.svc.branchAccess(id).subscribe({
      next: (a) => { this.loading.set(false); this.show(a); },
      error: (e: HttpErrorResponse) => { this.loading.set(false); this.error.set(apiMessage(e, 'The branch couriers could not be loaded.')); }
    });
  }

  /** What is ticked is what the branch's customers see now: with nothing set, OCCPL Network. */
  private show(a: BranchCourierAccess): void {
    this.access.set(a);
    this.saved = new Set(a.couriers.filter((o) => o.enabled).map((o) => o.code));
    this.picked.set(new Set(this.saved));
  }

  protected toggle(code: string): void {
    const next = new Set(this.picked());
    if (!next.delete(code)) next.add(code);
    this.picked.set(next);
  }

  protected save(): void {
    this.saving.set(true);
    this.svc.saveBranchAccess(this.branchId(), [...this.picked()]).subscribe({
      next: (a) => { this.saving.set(false); this.show(a); this.notify.success('Branch couriers saved.'); },
      error: (e: HttpErrorResponse) => { this.saving.set(false); this.notify.error(apiMessage(e, 'The branch couriers could not be saved.')); }
    });
  }
}
