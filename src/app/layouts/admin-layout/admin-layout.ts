import { ChangeDetectionStrategy, Component, DestroyRef, afterNextRender, inject, signal } from '@angular/core';
import { Router, RouterOutlet } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { NavigationService } from '@core/navigation/navigation.service';
import { pageIconFor } from '@core/navigation/page-icon';
import { TourService } from '@core/services/tour.service';
import { AuthService } from '@core/auth/auth.service';
import { IdleTimeoutService } from '@core/auth/idle-timeout.service';
import { Sidebar } from './components/sidebar';
import { Header } from './components/header';
import { Footer } from './components/footer';

/**
 * The authenticated shell. One toggle drives two behaviours by viewport:
 *  - desktop (>1024px): the dark rail collapses to icons and back;
 *  - tablet/mobile (≤1024px): the rail becomes an off-canvas drawer over a backdrop.
 * `matchMedia` tracks the breakpoint; leaving mobile closes the drawer so the desktop
 * layout never inherits a stray open state.
 */
@Component({
  selector: 'app-admin-layout',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterOutlet, Sidebar, Header, Footer, MatIconModule],
  template: `
    <div class="shell">
      <app-sidebar [mobileOpen]="drawerOpen()" (navigate)="closeDrawer()" />
      @if (drawerOpen()) { <div class="shell__backdrop" (click)="closeDrawer()"></div> }
      <div class="shell__main">
        @if (auth.isImpersonating()) {
          <div class="imp-banner">
            <mat-icon>admin_panel_settings</mat-icon>
            <span>Impersonating <strong>{{ auth.companyName() }}</strong> as {{ auth.displayName() }}
              — opened by {{ auth.impersonatedBy()!.email }}</span>
            <button type="button" class="imp-banner__exit" (click)="exitImpersonation()">Exit</button>
          </div>
        }
        <app-header (toggleSidebar)="toggle()" />
        <main class="shell__content app-scroll"><router-outlet /></main>
        <app-footer />
      </div>
    </div>
  `,
  styles: [`
    .shell { display:flex; height:100vh; overflow:hidden; background:transparent; }
    .shell__main { flex:1; display:flex; flex-direction:column; min-width:0; }
    .shell__content { flex:1; overflow:auto; padding:20px 28px 32px; background:transparent; }
    .shell__backdrop { position:fixed; inset:0; z-index:50; background:rgb(20 20 40 / 45%); backdrop-filter:blur(1px); }
    .imp-banner { display:flex; align-items:center; gap:10px; padding:8px 20px; font:600 16px var(--font-sans);
      background:var(--warning-bg, #fff7ed); color:var(--warning, #b45309); }
    .imp-banner mat-icon { font-size:18px; width:18px; height:18px; }
    .imp-banner span { flex:1; }
    .imp-banner__exit { font:700 15px var(--font-sans); color:inherit; background:rgba(0,0,0,.08);
      border:none; border-radius:var(--r-field); padding:4px 12px; cursor:pointer; }
    .imp-banner__exit:hover { background:rgba(0,0,0,.15); }
    @media (max-width: 1024px) { .shell__content { padding:20px 20px 24px; } }
    @media (max-width: 640px) { .shell__content { padding:14px 14px 20px; } }
  `]
})
export class AdminLayout {
  private readonly destroyRef = inject(DestroyRef);
  private readonly nav = inject(NavigationService);
  private readonly tour = inject(TourService);
  private readonly router = inject(Router);
  private readonly idleTimeout = inject(IdleTimeoutService);
  protected readonly auth = inject(AuthService);

  /** Mobile/tablet: drawer visible. Desktop collapse lives in NavigationService (persisted). */
  readonly drawerOpen = signal(false);
  private readonly isMobile = signal(false);

  constructor() {
    this.idleTimeout.start();
    this.destroyRef.onDestroy(() => this.idleTimeout.stop());

    // Sidebar/header DOM must be painted before driver.js can measure tour-step anchors.
    afterNextRender(() => {
      this.tour.maybeAutoStart();
      this.watchPageHeaders();
    });

    const mq = window.matchMedia('(max-width: 1024px)');
    const apply = (matches: boolean) => {
      this.isMobile.set(matches);
      if (!matches) this.drawerOpen.set(false); // leaving mobile: never keep the drawer open
    };
    apply(mq.matches);
    const onChange = (e: MediaQueryListEvent) => apply(e.matches);
    mq.addEventListener('change', onChange);
    this.destroyRef.onDestroy(() => mq.removeEventListener('change', onChange));
  }

  /**
   * Every page header shows its menu icon (see `.page__head[data-icon]` in styles.scss). Headers appear as pages load,
   * so new ones are tagged as they are added; a page with its own illustration keeps that instead.
   */
  private watchPageHeaders(): void {
    const main = document.querySelector('.shell__content');
    if (!main) return;
    const tag = () => main.querySelectorAll<HTMLElement>('.page__head:not([data-icon])').forEach((h) => {
      if (h.querySelector('.page__head-ill')) { h.setAttribute('data-icon', ''); return; }
      h.setAttribute('data-icon', pageIconFor(this.router.url));
    });
    const observer = new MutationObserver(tag);
    observer.observe(main, { childList: true, subtree: true });
    tag();
    this.destroyRef.onDestroy(() => observer.disconnect());
  }

  toggle(): void {
    if (this.isMobile()) this.drawerOpen.update((v) => !v);
    else this.nav.toggleCollapsed();
  }
  closeDrawer(): void { this.drawerOpen.set(false); }

  exitImpersonation(): void {
    this.auth.exitImpersonation();
    // Back to wherever the restored real session actually has a landing page: a
    // SUPER_ADMIN returns to the company list it launched impersonation from, a
    // COMPANY_ADMIN (no access to /companies) returns to its own dashboard.
    const target = this.auth.roles().includes('SUPER_ADMIN') ? '/companies' : '/dashboard';
    this.router.navigate([target]);
  }
}
