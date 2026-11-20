import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { RouterLink, ActivatedRoute } from '@angular/router';
import { map } from 'rxjs';
import { BUSINESS, PUBLIC_PAGE_CONTENT, PUBLIC_PAGE_LINKS, PublicPageKey } from './public-page.content';

/** One reusable renderer for every public (no-login) info/policy page — the
 *  page key comes from route data, content from {@link PUBLIC_PAGE_CONTENT}.
 *  Reached from the login screen so Razorpay reviewers (and anyone else) can
 *  see business/contact/policy info without an account. No auth guard. */
@Component({
  selector: 'app-public-page',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink],
  template: `
    <div class="pub">
      <header class="pub__bar">
        <a class="pub__brand" routerLink="/home">Amazing Logistics</a>
        <a class="pub__signin" routerLink="/login">Sign in</a>
      </header>

      <main class="pub__main app-card">
        <h1 class="text-display">{{ content().title }}</h1>
        <p class="pub__intro text-body">{{ content().intro }}</p>
        @for (section of content().sections; track section.heading) {
          <section class="pub__section">
            <h2 class="text-h2">{{ section.heading }}</h2>
            @for (p of section.body; track p) {
              <p class="text-body">{{ p }}</p>
            }
          </section>
        }
      </main>

      <footer class="pub__footer">
        <nav class="pub__links">
          @for (link of links; track link.key) {
            <a [routerLink]="'/' + link.key">{{ link.label }}</a>
          }
        </nav>
        <p class="text-caption">© {{ year }} {{ business.legalName }}. All rights reserved. GSTIN {{ business.gstin }}.</p>
      </footer>
    </div>
  `,
  styles: [`
    .pub { min-height:100vh; display:flex; flex-direction:column; background:var(--surface-muted); }
    .pub__bar { display:flex; align-items:center; justify-content:space-between; padding:20px 24px; }
    .pub__brand { font:700 21px var(--font-display); color:var(--content-fg); text-decoration:none; letter-spacing:-.01em; }
    .pub__signin { font:600 16px var(--font-sans); color:var(--brand-600); text-decoration:none; }
    .pub__main { flex:1; width:100%; max-width:760px; margin:0 auto; padding:40px 44px 56px; }
    .pub__intro { color:var(--content-muted); margin-top:8px; margin-bottom:8px; }
    .pub__section { margin-top:28px; display:flex; flex-direction:column; gap:8px; }
    .pub__section p { color:var(--content-fg); margin:0; }
    .pub__footer { padding:28px 24px 40px; display:flex; flex-direction:column; align-items:center; gap:14px; text-align:center; }
    .pub__links { display:flex; flex-wrap:wrap; justify-content:center; gap:8px 18px; max-width:720px; }
    .pub__links a { font:500 16px var(--font-sans); color:var(--content-muted); text-decoration:none; }
    .pub__links a:hover { color:var(--brand-600); text-decoration:underline; }
    @media (max-width:600px) { .pub__main { padding:28px 20px 40px; } }
  `]
})
export class PublicPage {
  private readonly route = inject(ActivatedRoute);

  protected readonly business = BUSINESS;
  protected readonly links = PUBLIC_PAGE_LINKS;
  protected readonly year = new Date().getFullYear();

  private readonly pageKey = toSignal(
    this.route.data.pipe(map((d) => d['pageKey'] as PublicPageKey)),
    { requireSync: true }
  );

  protected readonly content = computed(() => PUBLIC_PAGE_CONTENT[this.pageKey()]);
}
