import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { Router } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { AuthService } from '@core/auth/auth.service';

/** Header avatar + dropdown: identity, quick links, sign out. */
@Component({
  selector: 'app-user-menu',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatIconModule, MatMenuModule],
  template: `
    <button class="um__trigger" [matMenuTriggerFor]="menu" aria-label="Account menu">
      <span class="um__avatar">{{ initials() }}</span>
      <span class="um__name">{{ auth.displayName() || auth.user()?.email }}</span>
      <mat-icon class="um__caret">expand_more</mat-icon>
    </button>

    <mat-menu #menu="matMenu">
      <div class="um__head" (click)="$event.stopPropagation()">
        <span class="um__avatar um__avatar--lg">{{ initials() }}</span>
        <div class="um__id">
          <p class="um__id-name">{{ auth.displayName() || '—' }}</p>
          <p class="um__id-mail">{{ auth.user()?.email }}</p>
          <span class="um__id-role">{{ roleLabel() }}</span>
        </div>
      </div>
      <button mat-menu-item (click)="go('/settings')"><mat-icon>person</mat-icon> Profile</button>
      <button mat-menu-item (click)="go('/settings')"><mat-icon>settings</mat-icon> Settings</button>
      <button mat-menu-item class="um__signout" (click)="logout()"><mat-icon>logout</mat-icon> Sign out</button>
    </mat-menu>
  `,
  styles: [`
    .um__trigger { display:flex; align-items:center; gap:8px; padding:5px 10px 5px 5px; border-radius:14px;
      border:0; background:var(--surface-muted); box-shadow:var(--shadow-clay-inset); cursor:pointer; }
    .um__trigger:hover { box-shadow:var(--shadow-clay-inset), 0 0 0 2px var(--brand-100); }
    .um__avatar { width:32px; height:32px; border-radius:12px; background:linear-gradient(155deg, var(--brand-400), var(--brand-600)); color:#fff;
      display:grid; place-items:center; font:700 15px var(--font-sans); flex-shrink:0; box-shadow:var(--shadow-clay-sm); }
    .um__avatar--lg { width:40px; height:40px; font-size:18px; }
    .um__name { font:600 16px var(--font-sans); color:var(--content-fg); max-width:140px; overflow:hidden;
      text-overflow:ellipsis; white-space:nowrap; }
    .um__caret { color:var(--content-muted); }
    .um__head { display:flex; gap:12px; align-items:center; padding:14px 16px; border-bottom:1px solid var(--surface-border); }
    .um__id { min-width:0; }
    .um__id-name { margin:0; font:700 17px var(--font-sans); color:var(--content-fg);
      max-width:180px; overflow-wrap:break-word; }
    .um__id-mail { margin:2px 0 0; font:400 15px var(--font-sans); color:var(--content-muted);
      overflow:hidden; text-overflow:ellipsis; white-space:nowrap; max-width:180px; }
    .um__id-role { display:inline-block; margin-top:6px; padding:2px 8px; border-radius:999px;
      background:var(--brand-50); color:var(--brand-700); font:600 14px var(--font-sans); }
    .um__signout { color:var(--danger); }
    @media (max-width: 640px) { .um__name, .um__caret { display:none; } }
  `]
})
export class UserMenu {
  protected readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  readonly initials = computed(() => {
    const n = this.auth.displayName() || this.auth.user()?.email || '?';
    return n.split(/[\s@.]/).filter(Boolean).slice(0, 2).map((s) => s[0]?.toUpperCase()).join('');
  });

  roleLabel(): string { return this.auth.roles().join(', ') || '—'; }
  go(route: string): void { this.router.navigate([route]); }
  logout(): void { this.auth.logout().subscribe({ complete: () => this.router.navigate(['/login']) }); }
}
