import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { BreadcrumbService } from '@core/services/breadcrumb.service';
import { NotificationService } from '@core/services/notification.service';
import { BusDivision } from '@core/models/bus-depot.model';
import { UiCard } from '@shared/components/ui-card/ui-card';
import { UiInput } from '@shared/components/ui-input/ui-input';
import { UiButton } from '@shared/components/ui-button/ui-button';
import { UiLoader } from '@shared/components/ui-loader/ui-loader';
import { BusDepotService } from './bus-depot.service';

/** Create / edit one MSRTC division. */
@Component({
  selector: 'app-bus-division-form',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, UiCard, UiInput, UiButton, UiLoader],
  template: `
    <div class="page">
      <header class="page__head"><div>
        <h1 class="text-h1">{{ isCreate() ? 'New Division' : (division()?.divisionName || 'Division') }}</h1>
        <p class="text-caption">A division groups the depots and bus stations under it.</p>
      </div></header>
      @if (loading()) {
        <app-loader [minHeight]="200" caption="Loading…" />
      } @else if (!isCreate() && !division()) {
        <app-card><p class="empty">Division not found.</p></app-card>
      } @else {
        <app-card title="Division">
          <div class="grid">
            <app-input [control]="codeCtl" label="Code" [required]="true" placeholder="e.g. DIV-PUNE" [maxLength]="30" />
            <app-input [control]="nameCtl" label="Name" [required]="true" placeholder="e.g. Pune" [maxLength]="100" />
          </div>
        </app-card>
        <div class="bar">
          <app-button variant="stroked" (pressed)="back()">Cancel</app-button>
          <app-button icon="save" [loading]="saving()" (pressed)="save()">{{ isCreate() ? 'Create' : 'Save Changes' }}</app-button>
        </div>
      }
    </div>
  `,
  styles: [`
    .grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:16px 20px; }
    .empty { font:400 17px var(--font-sans); color:var(--content-muted); text-align:center; padding:16px; }
    .bar { display:flex; justify-content:flex-end; gap:10px; margin-top:8px; }
    @media (max-width:760px){ .grid { grid-template-columns:1fr; } }
  `]
})
export class BusDivisionForm implements OnInit {
  private readonly service = inject(BusDepotService);
  private readonly breadcrumb = inject(BreadcrumbService);
  private readonly notify = inject(NotificationService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  private readonly divisionId = this.route.snapshot.paramMap.get('id');
  protected readonly isCreate = computed(() => !this.divisionId);
  protected readonly loading = signal(true);
  protected readonly saving = signal(false);
  protected readonly division = signal<BusDivision | null>(null);
  protected readonly codeCtl = new FormControl<string>('', { nonNullable: true, validators: [Validators.required, Validators.maxLength(30)] });
  protected readonly nameCtl = new FormControl<string>('', { nonNullable: true, validators: [Validators.required, Validators.maxLength(100)] });

  ngOnInit(): void {
    this.breadcrumb.set([{ label: 'MSRTC' }, { label: 'Divisions', route: '/msrtc/divisions' }, { label: this.isCreate() ? 'New' : 'Edit' }]);
    if (!this.divisionId) { this.loading.set(false); return; }
    this.service.division(this.divisionId).subscribe({
      next: (v) => { this.division.set(v); this.codeCtl.setValue(v.divisionCode); this.nameCtl.setValue(v.divisionName); this.loading.set(false); },
      error: () => { this.division.set(null); this.loading.set(false); }
    });
  }

  protected save(): void {
    this.codeCtl.markAsTouched(); this.nameCtl.markAsTouched();
    if (this.codeCtl.invalid || this.nameCtl.invalid) return;
    const body = { divisionCode: this.codeCtl.value.trim(), divisionName: this.nameCtl.value.trim() };
    this.saving.set(true);
    const req = this.isCreate() ? this.service.createDivision(body)
      : this.service.updateDivision(this.divisionId!, { ...body, version: this.division()!.version });
    req.subscribe({
      next: () => { this.saving.set(false); this.notify.success(this.isCreate() ? 'Division created.' : 'Division updated.'); this.back(); },
      error: (e: HttpErrorResponse) => { this.saving.set(false); this.notify.error(e.error?.message ?? 'Could not save the division.'); }
    });
  }

  protected back(): void { this.router.navigate(['/msrtc/divisions']); }
}
