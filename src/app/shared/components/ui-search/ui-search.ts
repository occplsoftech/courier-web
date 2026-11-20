import { ChangeDetectionStrategy, Component, OnInit, inject, input, output } from '@angular/core';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { DestroyRef } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { debounceTime, distinctUntilChanged } from 'rxjs';

/** Debounced search box. Emits the trimmed term; escape/clear emits ''. */
@Component({
  selector: 'app-search',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, MatIconModule],
  template: `
    <label class="search-wrap">
      @if (label()) { <span class="search-wrap__label">{{ label() }}</span> }
      <div class="search">
        <mat-icon class="search__icon">search</mat-icon>
        <input class="search__input" [formControl]="control" [placeholder]="placeholder()" />
        @if (control.value) {
          <button class="search__clear" (click)="control.setValue('')"><mat-icon>close</mat-icon></button>
        }
      </div>
    </label>
  `,
  styles: [`
    .search-wrap { display:flex; flex-direction:column; gap:6px; width:100%; }
    .search-wrap__label { font:500 16px var(--font-sans); color:var(--content-fg); }
    .search { display:flex; align-items:center; gap:8px; height:42px; padding:0 14px; width:100%;
      background:var(--surface-muted); border:0; border-radius:var(--r-field); box-sizing:border-box;
      box-shadow:var(--shadow-clay-inset); }
    .search__icon { color:var(--content-muted); font-size:20px; }
    .search__input { border:0; outline:0; background:transparent; flex:1; font:400 17px var(--font-sans); color:var(--content-fg); }
    .search__clear { border:0; background:transparent; cursor:pointer; color:var(--content-muted); display:flex; }
  `]
})
export class UiSearch implements OnInit {
  private readonly destroyRef = inject(DestroyRef);
  readonly label = input('');
  readonly placeholder = input('Search…');
  readonly debounce = input(350);
  readonly changed = output<string>();
  readonly control = new FormControl('', { nonNullable: true });

  ngOnInit(): void {
    this.control.valueChanges.pipe(
      debounceTime(this.debounce()), distinctUntilChanged(), takeUntilDestroyed(this.destroyRef)
    ).subscribe((v) => this.changed.emit(v.trim()));
  }
}
