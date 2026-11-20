import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { BreadcrumbService } from '@core/services/breadcrumb.service';
import { NotificationService } from '@core/services/notification.service';
import { TicketService } from '@core/services/ticket.service';
import { TicketCategory, TicketSubCategory } from '@core/models/ticket.model';
import { UiCard } from '@shared/components/ui-card/ui-card';
import { UiButton } from '@shared/components/ui-button/ui-button';
import { StatusBadge } from '@shared/components/status-badge/status-badge';

/** SUPER_ADMIN-only global category/sub-category catalogue — every company reads the same
 *  list. Inline add-row + row actions, same shape as Freight Factor's grid. */
@Component({
  selector: 'app-ticket-categories',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, UiCard, UiButton, StatusBadge],
  template: `
    <div class="page">
      <header class="page__head">
        <div><h1 class="text-h1">Ticket Categories</h1><p class="text-caption">Global catalogue every company's tickets draw from.</p></div>
      </header>

      <div class="cols">
        <app-card title="Categories">
          @if (categories().length === 0) {
            <p class="text-caption">No categories yet.</p>
          } @else {
            <ul class="list">
              @for (c of categories(); track c.id) {
                <li class="row" [class.row--active]="selected()?.id === c.id" (click)="select(c)">
                  <span class="row__name">{{ c.name }}</span>
                  <app-status-badge [value]="c.active ? 'ACTIVE' : 'INACTIVE'" />
                  <div class="row__actions" (click)="$event.stopPropagation()">
                    <app-button variant="text" icon="edit" (pressed)="rename(c)">Rename</app-button>
                    <app-button variant="text" [icon]="c.active ? 'toggle_off' : 'toggle_on'" (pressed)="toggleCategory(c)">
                      {{ c.active ? 'Deactivate' : 'Activate' }}
                    </app-button>
                  </div>
                </li>
              }
            </ul>
          }
          <div class="add">
            <input class="add__i" type="text" placeholder="New category name…" [formControl]="newCategory" />
            <app-button icon="add" [loading]="savingCategory()" [disabled]="!newCategory.value.trim()" (pressed)="addCategory()">Add</app-button>
          </div>
        </app-card>

        <app-card [title]="selected() ? 'Sub-categories — ' + selected()!.name : 'Sub-categories'">
          @if (!selected()) {
            <p class="text-caption">Select a category to manage its sub-categories.</p>
          } @else {
            @if (subCategories().length === 0) {
              <p class="text-caption">No sub-categories yet.</p>
            } @else {
              <ul class="list">
                @for (s of subCategories(); track s.id) {
                  <li class="row">
                    <span class="row__name">{{ s.name }}</span>
                    <app-status-badge [value]="s.active ? 'ACTIVE' : 'INACTIVE'" />
                    <div class="row__actions">
                      <app-button variant="text" icon="edit" (pressed)="renameSub(s)">Rename</app-button>
                      <app-button variant="text" [icon]="s.active ? 'toggle_off' : 'toggle_on'" (pressed)="toggleSub(s)">
                        {{ s.active ? 'Deactivate' : 'Activate' }}
                      </app-button>
                    </div>
                  </li>
                }
              </ul>
            }
            <div class="add">
              <input class="add__i" type="text" placeholder="New sub-category name…" [formControl]="newSubCategory" />
              <app-button icon="add" [loading]="savingSubCategory()" [disabled]="!newSubCategory.value.trim()" (pressed)="addSubCategory()">Add</app-button>
            </div>
          }
        </app-card>
      </div>
    </div>
  `,
  styles: [`
    .cols { display:grid; grid-template-columns:1fr 1fr; gap:20px; align-items:start; }
    .list { list-style:none; margin:0 0 16px; padding:0; display:flex; flex-direction:column; gap:6px; }
    .row { display:flex; align-items:center; gap:12px; padding:10px 12px; border-radius:var(--r-field);
      background:var(--surface-muted); cursor:pointer; }
    .row--active { box-shadow:0 0 0 2px var(--brand-400); }
    .row__name { flex:1; font:500 17px var(--font-sans); color:var(--content-fg); }
    .row__actions { display:flex; gap:4px; }
    .add { display:flex; gap:10px; align-items:center; }
    .add__i { flex:1; height:42px; padding:0 14px; border:0; border-radius:var(--r-field);
      background:var(--surface-muted); box-shadow:var(--shadow-clay-inset); font:400 17px var(--font-sans); color:var(--content-fg); }
    @media (max-width:820px) { .cols { grid-template-columns:1fr; } }
  `]
})
export class TicketCategories implements OnInit {
  private readonly service = inject(TicketService);
  private readonly breadcrumb = inject(BreadcrumbService);
  private readonly notify = inject(NotificationService);

  readonly categories = signal<TicketCategory[]>([]);
  readonly subCategories = signal<TicketSubCategory[]>([]);
  readonly selected = signal<TicketCategory | null>(null);
  readonly savingCategory = signal(false);
  readonly savingSubCategory = signal(false);

  readonly newCategory = new FormControl('', { nonNullable: true });
  readonly newSubCategory = new FormControl('', { nonNullable: true });

  ngOnInit(): void {
    this.breadcrumb.set([{ label: 'Support' }, { label: 'Categories' }]);
    this.loadCategories();
  }

  private loadCategories(): void {
    this.service.categories().subscribe((cats) => this.categories.set(cats));
  }

  select(c: TicketCategory): void {
    this.selected.set(c);
    this.service.subCategories(c.id).subscribe((subs) => this.subCategories.set(subs));
  }

  addCategory(): void {
    const name = this.newCategory.value.trim();
    if (!name) return;
    this.savingCategory.set(true);
    this.service.createCategory(name).subscribe({
      next: () => { this.savingCategory.set(false); this.newCategory.setValue(''); this.notify.success('Category added.'); this.loadCategories(); },
      error: (err: HttpErrorResponse) => { this.savingCategory.set(false); this.notify.error(err.error?.message ?? 'Could not add the category.'); }
    });
  }

  rename(c: TicketCategory): void {
    const name = prompt('New category name', c.name);
    if (!name || !name.trim() || name.trim() === c.name) return;
    this.service.renameCategory(c.id, name.trim()).subscribe({
      next: () => { this.notify.success('Category renamed.'); this.loadCategories(); },
      error: (err: HttpErrorResponse) => this.notify.error(err.error?.message ?? 'Could not rename the category.')
    });
  }

  toggleCategory(c: TicketCategory): void {
    this.service.setCategoryActive(c.id, !c.active).subscribe({
      next: () => { this.notify.success(c.active ? 'Category deactivated.' : 'Category activated.'); this.loadCategories(); },
      error: (err: HttpErrorResponse) => this.notify.error(err.error?.message ?? 'Could not update the category.')
    });
  }

  addSubCategory(): void {
    const parent = this.selected();
    const name = this.newSubCategory.value.trim();
    if (!parent || !name) return;
    this.savingSubCategory.set(true);
    this.service.createSubCategory(parent.id, name).subscribe({
      next: () => { this.savingSubCategory.set(false); this.newSubCategory.setValue(''); this.notify.success('Sub-category added.'); this.select(parent); },
      error: (err: HttpErrorResponse) => { this.savingSubCategory.set(false); this.notify.error(err.error?.message ?? 'Could not add the sub-category.'); }
    });
  }

  renameSub(s: TicketSubCategory): void {
    const name = prompt('New sub-category name', s.name);
    const parent = this.selected();
    if (!name || !name.trim() || name.trim() === s.name || !parent) return;
    this.service.renameSubCategory(s.id, name.trim()).subscribe({
      next: () => { this.notify.success('Sub-category renamed.'); this.select(parent); },
      error: (err: HttpErrorResponse) => this.notify.error(err.error?.message ?? 'Could not rename the sub-category.')
    });
  }

  toggleSub(s: TicketSubCategory): void {
    const parent = this.selected();
    if (!parent) return;
    this.service.setSubCategoryActive(s.id, !s.active).subscribe({
      next: () => { this.notify.success(s.active ? 'Sub-category deactivated.' : 'Sub-category activated.'); this.select(parent); },
      error: (err: HttpErrorResponse) => this.notify.error(err.error?.message ?? 'Could not update the sub-category.')
    });
  }
}
