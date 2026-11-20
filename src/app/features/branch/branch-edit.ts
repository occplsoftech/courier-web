import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { ActivatedRoute, Router } from '@angular/router';
import { forkJoin } from 'rxjs';
import { BreadcrumbService } from '@core/services/breadcrumb.service';
import { NotificationService } from '@core/services/notification.service';
import { BranchResponse, CreateBranchRequest, UpdateBranchRequest } from '@core/models/branch.model';
import { UiCard } from '@shared/components/ui-card/ui-card';
import { UiLoader } from '@shared/components/ui-loader/ui-loader';
import { BranchForm } from './components/branch-form';
import { BranchService, Lookup } from './branch.service';

/** Edit Branch — loads the branch + manager lookup, PUTs a full replacement, handles 409. */
@Component({
  selector: 'app-branch-edit',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [UiCard, UiLoader, BranchForm],
  template: `
    <div class="page">
      <header class="page__head">
        <div><h1 class="text-h1">Edit Branch</h1><p class="text-caption">Update the branch. Status and manager have their own actions.</p></div>
      </header>
      @if (loading()) {
        <app-loader [minHeight]="280" caption="Loading…" />
      } @else if (!branch()) {
        <app-card><p class="empty">Branch not found or outside your scope.</p></app-card>
      } @else {
        <app-branch-form mode="edit" [branch]="branch()" [managers]="managers()" [saving]="saving()"
                         (saved)="save($event)" (cancelled)="cancel()" />
      }
    </div>
  `,
  styles: [`.empty{ font:400 17px var(--font-sans); color:var(--content-muted); text-align:center; padding:24px; }`]
})
export class BranchEdit implements OnInit {
  private readonly service = inject(BranchService);
  private readonly breadcrumb = inject(BreadcrumbService);
  private readonly notify = inject(NotificationService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  readonly loading = signal(true);
  readonly saving = signal(false);
  readonly branch = signal<BranchResponse | null>(null);
  readonly managers = signal<Lookup[]>([]);
  private id = '';

  ngOnInit(): void {
    this.id = this.route.snapshot.paramMap.get('id') ?? '';
    this.load();
  }

  private load(): void {
    this.loading.set(true);
    forkJoin({ branch: this.service.get(this.id), managers: this.service.managers() }).subscribe({
      next: (l) => {
        this.branch.set(l.branch); this.managers.set(l.managers);
        this.breadcrumb.set([{ label: 'Branches', route: '/branches' }, { label: l.branch.branchName, route: `/branches/${this.id}` }, { label: 'Edit' }]);
        this.loading.set(false);
      },
      error: () => { this.branch.set(null); this.loading.set(false); }
    });
  }

  save(body: CreateBranchRequest | UpdateBranchRequest): void {
    this.saving.set(true);
    this.service.update(this.id, body as UpdateBranchRequest).subscribe({
      next: () => { this.saving.set(false); this.notify.success('Branch updated.'); this.router.navigate(['/branches', this.id]); },
      error: (err: HttpErrorResponse) => {
        this.saving.set(false);
        if (err.status === 409) { this.notify.error('This branch changed since you opened it. Reloading the latest version.'); this.load(); }
        else if (err.status === 400 || err.status === 422) this.notify.error(err.error?.message ?? 'Please correct the highlighted fields.');
        else this.notify.error('Could not update the branch.');
      }
    });
  }

  cancel(): void { this.router.navigate(['/branches', this.id]); }
}
