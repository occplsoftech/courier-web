import { ChangeDetectionStrategy, Component, DestroyRef, OnInit, computed, effect, inject, input, model, signal, untracked } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { BusCrossingPick, BusCrossingRoute, BusDepot, depotRefLabel } from '@core/models/bus-depot.model';
import { UiAutocomplete } from '@shared/components/ui-autocomplete/ui-autocomplete';
import { SelectOption } from '@shared/components/ui-select/ui-select';
import { UiButton } from '@shared/components/ui-button/ui-button';
import { BusDepotService } from './bus-depot.service';

/**
 * Picks a crossing route: bus goes From -> (crossing points) -> To, each a bus depot or
 * station, in any combination. Used by MSRTC booking and by the Crossings master.
 *
 * With `fromBranchId` / `toBranchId` (booking) the From / To choices are the depots assigned
 * to those branches, and a route already saved for the trip is applied by itself — the first
 * booking saves it, the next ones just pick it up. Without them, every depot / station is offered.
 *
 * `value` is the complete route, or null when crossing is off / unfinished; `incomplete` is
 * true when crossing is on but not yet fully filled, so the caller can hold the Book button.
 */
@Component({
  selector: 'app-bus-crossing-editor',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, UiAutocomplete, UiButton],
  template: `
    @if (optional()) {
      <label class="chk">
        <input type="checkbox" [formControl]="enabledCtl" />
        <span>No direct bus — route through a crossing point</span>
      </label>
    }
    @if (enabled()) {
      @if (suggestions().length) {
        <div class="sugg">
          <p class="sugg__t">{{ suggestions().length === 1 ? 'Saved crossing for this trip' : suggestions().length + ' saved crossings for this trip — pick the one you need' }}</p>
          @for (r of suggestions(); track r.id) {
            <button type="button" class="sugg__i" [class.sugg__i--on]="selectedRoute() === r.id" (click)="choose(r)">
              <span class="sugg__path">{{ pathOf(r) }}</span>
              @if (selectedRoute() === r.id) { <span class="sugg__tag">Selected</span> }
            </button>
          }
          <p class="sugg__h">Or enter different crossing points below.</p>
        </div>
      }
      <div class="row2">
        <app-autocomplete [control]="fromCtl" label="From (depot / station)" [options]="fromOptions()" placeholder="Search depot or station…" />
        <app-autocomplete [control]="toCtl" label="To (depot / station)" [options]="toOptions()" placeholder="Search depot or station…" />
      </div>
      <div class="stops">
        @for (ctl of stopCtls(); track ctl; let i = $index) {
          <div class="stop">
            <app-autocomplete [control]="ctl" [label]="'Crossing point ' + (i + 1)" [options]="stopOptions()" placeholder="Search depot or station…" />
            @if (stopCtls().length > 1) {
              <button type="button" class="stop__x" (click)="removeStop(i)" aria-label="Remove this crossing point">✕</button>
            }
          </div>
        }
        <app-button variant="stroked" (pressed)="addStop()">+ Add crossing point</app-button>
      </div>
      <p class="hint">Saved for next time: the same From → To trip picks this crossing automatically.</p>
    }
  `,
  styles: [`
    .chk { display:flex; align-items:center; gap:8px; font:500 17px var(--font-sans); cursor:pointer; }
    .row2 { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:12px 16px; margin-top:10px; }
    .stops { display:flex; flex-direction:column; gap:8px; margin-top:10px; }
    .stop { display:flex; align-items:flex-end; gap:8px; }
    .stop app-autocomplete { flex:1; }
    .stop__x { flex-shrink:0; height:38px; width:38px; border:1px solid var(--surface-border); background:transparent;
               border-radius:8px; cursor:pointer; color:var(--content-muted); }
    .stop__x:hover { color:var(--danger, #e11d48); border-color:currentColor; }
    .sugg { margin-top:10px; display:flex; flex-direction:column; gap:6px; }
    .sugg__t { margin:0; font:600 16px var(--font-sans); }
    .sugg__h { margin:0; font:400 15px var(--font-sans); color:var(--content-muted); }
    .sugg__i { display:flex; justify-content:space-between; align-items:center; gap:8px; text-align:left; cursor:pointer;
               border:1px solid var(--surface-border); background:var(--surface-muted); border-radius:10px; padding:10px 12px; font:500 16px var(--font-sans); color:inherit; }
    .sugg__i:hover { border-color:var(--brand-600, #4f46e5); }
    .sugg__i--on { border-color:var(--brand-600, #4f46e5); box-shadow:0 0 0 2px var(--brand-100); }
    .sugg__tag { font:600 14px var(--font-sans); color:var(--brand-600, #4f46e5); }
    .hint { margin:8px 0 0; font:400 15px var(--font-sans); color:var(--content-muted); }
    @media (max-width:760px){ .row2 { grid-template-columns:1fr; } }
  `]
})
export class BusCrossingEditor implements OnInit {
  private readonly service = inject(BusDepotService);
  private readonly destroyRef = inject(DestroyRef);

  readonly fromBranchId = input<string | null>(null);
  readonly toBranchId = input<string | null>(null);
  /** Show the on/off checkbox (booking). Off = always on (the Crossings master). */
  readonly optional = input(true);
  /** Start filled with this route (editing a saved one). */
  readonly initial = input<BusCrossingPick | null>(null);
  /** Offer the crossings already saved for the chosen trip. Off when editing one saved route. */
  readonly suggest = input(true);

  readonly value = model<BusCrossingPick | null>(null);
  readonly incomplete = model(false);

  protected readonly enabledCtl = new FormControl(false, { nonNullable: true });
  protected readonly fromCtl = new FormControl<string | null>(null);
  protected readonly toCtl = new FormControl<string | null>(null);
  protected readonly stopCtls = signal<FormControl<string | null>[]>([new FormControl<string | null>(null)]);
  /** Saved crossings for the chosen trip. */
  protected readonly suggestions = signal<BusCrossingRoute[]>([]);
  protected readonly selectedRoute = signal<string | null>(null);

  private readonly depots = signal<BusDepot[]>([]);
  // Mirrors of the control values — signals so the computeds below track them.
  private readonly enabledV = signal(false);
  private readonly fromV = signal<string | null>(null);
  private readonly toV = signal<string | null>(null);
  private readonly stopsV = signal<(string | null)[]>([null]);

  protected readonly enabled = computed(() => !this.optional() || this.enabledV());

  private opt(d: BusDepot): SelectOption {
    return { value: d.id, label: depotRefLabel(d) };
  }

  /** Depots assigned to the branch, or every depot when none is (or no branch is given). */
  private forBranch(branchId: string | null): SelectOption[] {
    const all = this.depots();
    const mine = branchId ? all.filter((d) => d.branchId === branchId) : [];
    return (mine.length ? mine : all).map((d) => this.opt(d));
  }

  protected readonly fromOptions = computed(() => this.forBranch(this.fromBranchId()).filter((o) => o.value !== this.toV()));
  protected readonly toOptions = computed(() => this.forBranch(this.toBranchId()).filter((o) => o.value !== this.fromV()));
  protected readonly stopOptions = computed(() =>
    this.depots().filter((d) => d.id !== this.fromV() && d.id !== this.toV()).map((d) => this.opt(d)));

  constructor() {
    // Pick-up of a saved route when the booking's two branches are known.
    effect(() => {
      const from = this.fromBranchId();
      const to = this.toBranchId();
      const loaded = this.depots().length > 0;
      if (!loaded) return;
      untracked(() => this.onBranchesChanged(from, to));
    });
    // Publish the finished route (or null) to the parent.
    effect(() => {
      const on = this.enabled();
      const from = this.fromV();
      const to = this.toV();
      const stops = this.stopsV();
      // The autocomplete holds the typed text until an option is chosen — only a real depot id counts.
      const known = new Set(this.depots().map((d) => d.id));
      const filled = stops.filter((s): s is string => !!s && known.has(s));
      const complete = !!from && known.has(from) && !!to && known.has(to) && filled.length > 0 && filled.length === stops.length;
      untracked(() => {
        this.value.set(on && complete ? { fromDepotId: from!, toDepotId: to!, stops: filled } : null);
        this.incomplete.set(on && !complete);
      });
    });
  }

  ngOnInit(): void {
    this.service.list({ status: 'ACTIVE' }).subscribe((d) => this.depots.set(d ?? []));
    this.enabledCtl.valueChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((v) => this.enabledV.set(v));
    this.fromCtl.valueChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((v) => { this.fromV.set(v); this.tripChanged(); });
    this.toCtl.valueChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((v) => { this.toV.set(v); this.tripChanged(); });
    this.watchStops(this.stopCtls()[0]);
    const init = this.initial();
    if (init) this.fill(init, null);
  }

  protected addStop(): void {
    const ctl = new FormControl<string | null>(null);
    this.watchStops(ctl);
    this.stopCtls.update((l) => [...l, ctl]);
    this.syncStops();
  }

  protected removeStop(i: number): void {
    this.stopCtls.update((l) => l.filter((_, idx) => idx !== i));
    this.syncStops();
  }

  private watchStops(ctl: FormControl<string | null>): void {
    ctl.valueChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => { this.syncStops(); this.selectedRoute.set(null); });
  }

  private syncStops(): void {
    this.stopsV.set(this.stopCtls().map((c) => c.value));
  }

  private fill(p: BusCrossingPick, applied: string | null): void {
    this.enabledCtl.setValue(true);
    this.fromCtl.setValue(p.fromDepotId, { emitEvent: false });
    this.toCtl.setValue(p.toDepotId, { emitEvent: false });
    this.fromV.set(p.fromDepotId);
    this.toV.set(p.toDepotId);
    const ctls = p.stops.map((s) => {
      const c = new FormControl<string | null>(s);
      this.watchStops(c);
      return c;
    });
    this.stopCtls.set(ctls.length ? ctls : [new FormControl<string | null>(null)]);
    this.syncStops();
    this.selectedRoute.set(applied);
  }

  private fillFromRoute(r: BusCrossingRoute): void {
    this.fill({ fromDepotId: r.from.id, toDepotId: r.to.id, stops: r.stops.map((s) => s.id) }, r.id);
  }

  protected pathOf(r: BusCrossingRoute): string {
    return [r.from, ...r.stops, r.to].map((d) => d.depotName).join(' → ');
  }

  /** The booking desk picks one of the saved crossings. */
  protected choose(r: BusCrossingRoute): void {
    this.fillFromRoute(r);
  }

  /** Booking branches changed: offer every saved crossing for them (one alone is applied), else preselect a lone depot per side. */
  private onBranchesChanged(from: string | null, to: string | null): void {
    if (!from || !to || !this.suggest()) return;
    this.service.crossingLookup({ fromBranchId: from, toBranchId: to }).subscribe({
      next: (list) => {
        this.suggestions.set(list ?? []);
        if (list?.length && !this.initial()) this.enabledCtl.setValue(true);
        if (list?.length === 1 && !this.initial()) { this.fillFromRoute(list[0]); return; }
        if (list?.length) return;
        this.selectedRoute.set(null);
        const f = this.fromOptions();
        const t = this.toOptions();
        if (!this.fromCtl.value && f.length === 1) this.fromCtl.setValue(f[0].value);
        if (!this.toCtl.value && t.length === 1) this.toCtl.setValue(t[0].value);
      },
      error: () => this.selectedRoute.set(null)
    });
  }

  /** Both ends picked by hand: offer the crossings saved for exactly that pair; a lone one fills an empty form. */
  private tripChanged(): void {
    const from = this.fromCtl.value;
    const to = this.toCtl.value;
    if (!this.suggest() || !from || !to || from === to) { this.suggestions.set([]); return; }
    this.service.crossingLookup({ fromDepotId: from, toDepotId: to }).subscribe((list) => {
      this.suggestions.set(list ?? []);
      if (list?.length === 1 && !this.stopsV().some((s) => !!s)) this.fillFromRoute(list[0]);
    });
  }
}
