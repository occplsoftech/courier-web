import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { BreadcrumbService } from '@core/services/breadcrumb.service';
import { NotificationService } from '@core/services/notification.service';
import { UiCard } from '@shared/components/ui-card/ui-card';
import { UiLoader } from '@shared/components/ui-loader/ui-loader';
import { MasterDataService } from '../masters/master-data.service';
import { BranchService } from './branch.service';

/**
 * Assign Hub to Branch — each non-hub branch names the hub its Loading Sheets go to by
 * default (`branches.assigned_hub_id`, V96). Loading Sheet preselects "Send to Hub" with
 * this hub; branches with no hub assigned fall back to the manual picker.
 */
@Component({
  selector: 'app-branch-hub-assignment',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [UiCard, UiLoader],
  template: `
    <div class="page">
      <header class="page__head">
        <div>
          <h1 class="text-h1">Assign Hub to Branch</h1>
          <p class="text-caption">Loading Sheets created at a branch go to its assigned hub by default.</p>
        </div>
      </header>

      <app-card [title]="'Branches (' + branches().length + ')'">
        @if (loading()) {
          <app-loader [minHeight]="100" caption="Loading…" />
        } @else if (!hubs().length) {
          <p class="empty">No hub exists yet. Create a branch of type HUB first.</p>
        } @else if (!branches().length) {
          <p class="empty">No branches found.</p>
        } @else {
          <div class="tbl__wrap">
            <table class="tbl">
              <thead><tr><th>Branch</th><th>City</th><th>Assigned Hub</th></tr></thead>
              <tbody>
                @for (b of branches(); track b.id) {
                  <tr>
                    <td class="tbl__code">{{ b.branchName }} ({{ b.branchCode }})</td>
                    <td>{{ b.city || '—' }}</td>
                    <td>
                      <select class="sel" [disabled]="saving().has(b.id)"
                        (change)="assign(b, $any($event.target).value)">
                        <option value="" [selected]="!b.assignedHubId">— None —</option>
                        @for (h of hubs(); track h.id) {
                          <option [value]="h.id" [selected]="b.assignedHubId === h.id">{{ h.branchName }} ({{ h.branchCode }})</option>
                        }
                      </select>
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        }
      </app-card>
    </div>
  `,
  styles: [`
    .empty { font:400 17px var(--font-sans); color:var(--content-muted); text-align:center; padding:20px; }
    .tbl__wrap { overflow-x:auto; }
    .tbl { width:100%; border-collapse:collapse; font:400 17px var(--font-sans); }
    .tbl th { text-align:left; font:500 15px var(--font-sans); color:var(--content-muted);
      text-transform:uppercase; letter-spacing:.04em; padding:0 12px 8px; }
    .tbl td { padding:10px 12px; border-top:1px solid var(--surface-border); color:var(--content-fg); }
    .tbl__code { font-weight:600; }
    .sel { min-width:240px; padding:8px 10px; border:1px solid var(--surface-border); border-radius:var(--r-field);
      background:var(--surface-card, #fff); color:var(--content-fg); font:400 17px var(--font-sans); }
  `]
})
export class BranchHubAssignment implements OnInit {
  private readonly branchService = inject(BranchService);
  private readonly masterData = inject(MasterDataService);
  private readonly breadcrumb = inject(BreadcrumbService);
  private readonly notify = inject(NotificationService);

  readonly loading = signal(true);
  readonly all = signal<{ id: string; branchCode: string; branchName: string; branchType?: string;
    city?: string | null; assignedHubId?: string | null }[]>([]);
  readonly saving = signal<ReadonlySet<string>>(new Set());

  readonly hubs = computed(() => this.all().filter((b) => b.branchType === 'HUB'));
  readonly branches = computed(() => this.all().filter((b) => b.branchType !== 'HUB'));

  ngOnInit(): void {
    this.breadcrumb.set([{ label: 'Masters' }, { label: 'Assign Hub to Branch' }]);
    this.reload();
  }

  private reload(): void {
    this.masterData.clearOptionCache();
    this.masterData.branchDirectory().subscribe({
      next: (list) => { this.all.set(list); this.loading.set(false); },
      error: () => { this.all.set([]); this.loading.set(false); }
    });
  }

  assign(branch: { id: string; branchName: string }, hubId: string): void {
    this.saving.update((s) => new Set(s).add(branch.id));
    this.branchService.assignHub(branch.id, hubId || null).subscribe({
      next: () => {
        this.saving.update((s) => { const n = new Set(s); n.delete(branch.id); return n; });
        this.all.update((l) => l.map((b) => b.id === branch.id ? { ...b, assignedHubId: hubId || null } : b));
        this.masterData.clearOptionCache();
        this.notify.success(hubId ? `Hub assigned to ${branch.branchName}.` : `Hub cleared for ${branch.branchName}.`);
      },
      error: (e) => {
        this.saving.update((s) => { const n = new Set(s); n.delete(branch.id); return n; });
        this.notify.error(e.error?.message ?? 'Could not assign the hub.');
        this.reload();
      }
    });
  }
}
