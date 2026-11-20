import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';

/** Split auth screen: a branded panel and the form outlet. */
@Component({
  selector: 'app-auth-layout',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterOutlet],
  template: `
    <div class="auth">
      <aside class="auth__brand">
        <div class="auth__brand-top">
          <img src="assets/images/skara-tech-logo.png" alt="Skara Tech" class="auth__logo-img" />
        </div>
        <div class="auth__illustration">
          <img src="assets/images/login-hero.png" alt="" class="auth__hero-img" />
        </div>
        <div class="auth__pitch">
          <h2>Run your entire courier network from one console.</h2>
          <p>Multi-company. Role-aware. Built for scale — bookings, hubs, delivery, finance and reporting.</p>
        </div>
        <div class="auth__foot">© {{ year }} Courier SaaS. All rights reserved.</div>
      </aside>
      <main class="auth__panel"><router-outlet /></main>
    </div>
  `,
  styles: [`
    .auth { min-height:100vh; display:grid; grid-template-columns:1.1fr 1fr; gap:16px; padding:16px; }
    .auth__brand { position:relative; padding:48px; color:var(--sidebar-fg); border-radius:28px; box-shadow:var(--occpl-shadow-md);
      background:var(--occpl-gradient-brand);
      display:flex; flex-direction:column; justify-content:space-between; overflow:hidden; }
    .auth__brand-top { display:flex; align-items:center; gap:12px; }
    .auth__logo-img { height:56px; width:auto; border-radius:12px; background:#fff; padding:6px 14px; box-shadow:var(--shadow-clay-sm); }
    .auth__illustration { margin:8px 0; display:grid; place-items:center; }
    .auth__hero-img { width:100%; max-width:520px; height:auto; filter:drop-shadow(0 20px 30px rgba(0,0,0,.35)); }
    .auth__pitch h2 { font:700 37px/1.15 var(--font-display); letter-spacing:-.02em; color:var(--sidebar-fg-strong); max-width:16ch; }
    .auth__pitch p { color:var(--sidebar-fg); max-width:44ch; line-height:1.6; }
    .auth__foot { font-size:16px; color:var(--sidebar-section); }
    .auth__panel { display:grid; place-items:center; padding:32px; }
    @media (max-width: 900px) { .auth { grid-template-columns:1fr; } .auth__brand { display:none; } }
  `]
})
export class AuthLayout { protected readonly year = new Date().getFullYear(); }
