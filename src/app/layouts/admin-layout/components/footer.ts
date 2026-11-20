import { ChangeDetectionStrategy, Component } from '@angular/core';
import { environment } from '@env/environment';

/** App footer: copyright, version and build environment. */
@Component({
  selector: 'app-footer',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <footer class="ft">
      <span class="ft__copy">© {{ year }} Courier SaaS. All rights reserved.</span>
      <span class="ft__meta">
        <a href="#">Privacy</a><a href="#">Terms</a><a href="#">Support</a>
        <span class="ft__ver">v{{ version }}</span>
        @if (!isProd) { <span class="ft__env">{{ env }}</span> }
      </span>
    </footer>
  `,
  styles: [`
    .ft { display:flex; align-items:center; justify-content:space-between; gap:12px; padding:14px 32px;
      border-top:0; color:var(--content-muted); font:400 16px var(--font-sans); }
    @media (max-width:1024px){ .ft{ padding:14px 24px; } }
    @media (max-width:640px){ .ft{ padding:12px 16px; } }
    .ft__meta { display:flex; align-items:center; gap:16px; }
    .ft__meta a { color:var(--content-muted); text-decoration:none; }
    .ft__meta a:hover { color:var(--brand-600); }
    .ft__ver { font:600 15px var(--font-sans); color:var(--content-muted); }
    .ft__env { padding:1px 8px; border-radius:999px; background:var(--warning-bg, var(--brand-50));
      color:var(--warning, var(--brand-700)); font:700 14px var(--font-sans); text-transform:uppercase; letter-spacing:.04em; }
    @media (max-width: 560px) { .ft__meta a { display:none; } }
  `]
})
export class Footer {
  protected readonly year = new Date().getFullYear();
  protected readonly version = environment.version;
  protected readonly env = environment.envLabel;
  protected readonly isProd = environment.production;
}
