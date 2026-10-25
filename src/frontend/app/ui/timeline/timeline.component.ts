import {SelectionService} from '../gallery/selection/selection.service';
import {SelectionBarComponent} from '../gallery/selection/selection-bar.component';
import {MediaButtonModalComponent} from '../gallery/grid/photo/media-button-modal/media-button-modal.component';
import {
  ChangeDetectorRef,
  Component,
  ElementRef,
  HostListener,
  Inject,
  LOCALE_ID,
  NgZone,
  OnDestroy,
  OnInit,
  ViewChild,
} from '@angular/core';
import {ActivatedRoute, ParamMap, Router, RouterLink} from '@angular/router';
import {Subscription} from 'rxjs';
import {NgFor, NgIf} from '@angular/common';
import {NgIconComponent} from '@ng-icons/core';
import {FrameComponent} from '../frame/frame.component';
import {TimelineService} from './timeline.service';
import {MediaDTO, MediaDTOUtils} from '../../../../common/entities/MediaDTO';
import {Media} from '../gallery/Media';
import {Utils} from '../../../../common/Utils';
import {QueryParams} from '../../../../common/QueryParams';
import {PageHelper} from '../../model/page.helper';
import {PiTitleService} from '../../model/pi-title.service';
import {LightboxService} from '../gallery/lightbox/lightbox.service';
import {SearchQueryDTO, SearchQueryTypes, TextSearch} from '../../../../common/entities/SearchQueryDTO';
import {SearchQueryUtils} from '../../../../common/SearchQueryUtils';
import {SearchQueryParser} from '../../../../common/SearchQueryParser';

interface Tile {
  media: MediaDTO;
  src: string;
  video: boolean;
}

interface DayBlock {
  day: string;       // YYYY-MM-DD
  label: string;
  count: number;
  top: number;       // relative to its month
  height: number;
  tiles?: Tile[];    // once the month is loaded
}

interface MonthBlock {
  month: string;     // YYYY-MM
  label: string;
  top: number;       // relative to the timeline container
  height: number;
  days: DayBlock[];
  loaded: boolean;
}

interface YearMark {
  year: string;
  y: number;         // px from the top of the scrubber track
}

/**
 * Google Photos-like timeline: every media of the gallery, newest first,
 * grouped by month and day, with square thumbnails and a year scrubber.
 *
 * The layout is computed from the per-day counts only (/api/timeline), so the
 * full height of the page is known from the start: the scrubber can jump
 * anywhere, and only the months around the viewport are loaded (one date
 * range search per month) and rendered.
 */
import {AuthenticationService} from '../../model/network/authentication.service';
@Component({
  selector: 'app-timeline',
  templateUrl: './timeline.component.html',
  styleUrls: ['./timeline.component.css'],
  imports: [FrameComponent, NgFor, NgIf, NgIconComponent, RouterLink, SelectionBarComponent, MediaButtonModalComponent],
})
export class TimelineComponent implements OnInit, OnDestroy {
  @ViewChild('container', {static: true}) container: ElementRef<HTMLElement>;
  @ViewChild('track', {static: true}) track: ElementRef<HTMLElement>;

  static readonly GAP = 2;
  static readonly MONTH_HEADER = 56;
  static readonly DAY_HEADER = 36;
  static readonly MIN_TILE = 100;       // phones: 4 columns or more
  static readonly MIN_TILE_WIDE = 180;  // tablets and desktops

  public months: MonthBlock[] = [];
  public visibleMonths: MonthBlock[] = [];
  public totalHeight = 0;
  public tileSize = TimelineComponent.MIN_TILE;
  public columns = 4;
  public loading = true;
  public error: string = null;
  /** Optional search filter (?q=, e.g. a person), shown above the timeline. */
  public filter: SearchQueryDTO = null;
  public showSearchBar = false;
  public filterLabel = '';
  public filterIsPerson = false;
  public totalCount = '';

  // scrubber
  public years: YearMark[] = [];
  public handleY = 0;
  public bubble = '';
  public scrubberActive = false;
  public dragging = false;
  public showScrubber = false;

  private dayCounts: [string, number][] = [];
  private visibleRange = {from: 0, to: 0};
  private scrubberTimer: number = null;
  private loadTimer: number = null;
  private readonly requested = new Set<string>();
  private readonly monthFormat: Intl.DateTimeFormat;
  private readonly dayFormat: Intl.DateTimeFormat;
  private readonly numberFormat: Intl.NumberFormat;
  private readonly onScroll = (): void => this.scheduleUpdate();
  private readonly onPageHide = (): void => {
    this.timelineService.setScrollY(PageHelper.ScrollY, this.filter);
  };
  private updateScheduled = false;
  private restoreScroll: boolean;
  private routeSubscription: Subscription = null;

  constructor(
    private timelineService: TimelineService,
    private router: Router,
    private zone: NgZone,
    private cd: ChangeDetectorRef,
    private piTitleService: PiTitleService,
    private lightboxService: LightboxService,
    private route: ActivatedRoute,
    public selection: SelectionService,
    private authService: AuthenticationService,
    @Inject(LOCALE_ID) locale: string
  ) {
    this.showSearchBar = this.authService.canSearch();
    // Same place as before only when coming back (lightbox closed, browser
    // back) or reloading the page; from a menu link, start from the top.
    const nav = this.router.getCurrentNavigation();
    const reload = (performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming)?.type === 'reload';
    this.restoreScroll = nav?.trigger === 'popstate' || (nav?.id === 1 && reload);
    this.monthFormat = new Intl.DateTimeFormat(locale, {month: 'long', year: 'numeric', timeZone: 'UTC'});
    this.dayFormat = new Intl.DateTimeFormat(locale, {weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC'});
    this.numberFormat = new Intl.NumberFormat(locale);
  }

  ngOnInit(): void {
    this.piTitleService.setTitle($localize`Timeline`);
    this.lightboxService.backOnCloseUrl = null;
    this.zone.runOutsideAngular(() => window.addEventListener('scroll', this.onScroll, {passive: true}));
    window.addEventListener('pagehide', this.onPageHide);
    // The same component shows every filter: reload when ?q= changes.
    this.routeSubscription = this.route.queryParamMap.subscribe((params: ParamMap) => {
      this.show(SearchQueryUtils.parseURLifiedQuery(params.get(QueryParams.gallery.timeline.query)))
        .catch(console.error);
    });
  }

  private async show(filter: SearchQueryDTO): Promise<void> {
    if (this.dayCounts.length && JSON.stringify(filter) !== JSON.stringify(this.filter)) {
      this.restoreScroll = false; // another person: from the top
    }
    this.filter = filter;
    this.filterIsPerson = filter?.type === SearchQueryTypes.person;
    this.filterLabel = !filter ? '' : this.filterIsPerson ? (filter as TextSearch).value : new SearchQueryParser().stringify(filter);
    this.piTitleService.setTitle(this.filterLabel || $localize`Timeline`);
    this.loading = true;
    this.error = null;
    this.months = [];
    this.visibleMonths = [];
    this.dayCounts = [];
    this.totalHeight = 0;
    try {
      this.dayCounts = (await this.timelineService.getDays(filter)).days;
    } catch (e) {
      this.error = '' + (e?.message || e);
      this.loading = false;
      return;
    }
    this.totalCount = this.numberFormat.format(this.dayCounts.reduce((n, d) => n + d[1], 0));
    this.loading = false;
    this.layout();
    this.cd.detectChanges();
    PageHelper.ScrollY = this.restoreScroll ? this.timelineService.getScrollY(filter) : 0;
    this.restoreScroll = false;
    this.update();
  }

  ngOnDestroy(): void {
    window.removeEventListener('scroll', this.onScroll);
    window.removeEventListener('pagehide', this.onPageHide);
    this.routeSubscription?.unsubscribe();
    if (this.scrubberTimer) {
      clearTimeout(this.scrubberTimer);
    }
    if (this.loadTimer) {
      clearTimeout(this.loadTimer);
    }
  }

  @HostListener('window:resize')
  onResize(): void {
    if (!this.months.length) {
      return;
    }
    // Keep the month at the top of the screen in place.
    const m = this.monthAt(this.viewTop());
    const offset = m ? (this.viewTop() - m.top) / Math.max(1, m.height) : 0;
    this.layout();
    this.cd.detectChanges();
    if (m) {
      const n = this.months.find(x => x.month === m.month);
      PageHelper.ScrollY = this.containerTop() + n.top + offset * n.height;
    }
    this.update();
  }

  /** Positions of every month and day, from the counts only. */
  private layout(): void {
    const width = this.container.nativeElement.clientWidth || window.innerWidth;
    const G = TimelineComponent.GAP;
    const minTile = width < 768 ? TimelineComponent.MIN_TILE : TimelineComponent.MIN_TILE_WIDE;
    this.columns = Math.max(4, Math.floor((width + G) / (minTile + G)));
    this.tileSize = Math.floor((width - G * (this.columns - 1)) / this.columns);
    const row = this.tileSize + G;

    const old = new Map(this.months.map(m => [m.month, m]));
    this.months = [];
    let top = 0;
    let current: MonthBlock = null;
    for (const [day, count] of this.dayCounts) {
      const month = day.substring(0, 7);
      if (!current || current.month !== month) {
        current = {
          month,
          label: this.capitalize(this.monthFormat.format(new Date(month + '-01T00:00:00Z'))),
          top,
          height: TimelineComponent.MONTH_HEADER,
          days: [],
          loaded: false,
        };
        this.months.push(current);
      }
      const height = TimelineComponent.DAY_HEADER + Math.ceil(count / this.columns) * row;
      current.days.push({
        day,
        label: this.capitalize(this.dayFormat.format(new Date(day + 'T00:00:00Z'))),
        count,
        top: current.height,
        height,
      });
      current.height += height;
      top += height + (current.days.length === 1 ? TimelineComponent.MONTH_HEADER : 0);
    }
    this.totalHeight = top;
    // Thumbnail sizes depend on the tile size: rebuild the loaded months.
    for (const m of this.months) {
      if (old.get(m.month)?.loaded) {
        this.timelineService.getMonth(m.month, this.filter).then(media => this.fill(m, media)).catch(console.error);
      }
    }
    this.layoutScrubber();
  }

  private layoutScrubber(): void {
    const trackHeight = this.track.nativeElement.clientHeight || window.innerHeight * 0.8;
    const max = this.maxScroll();
    this.showScrubber = this.totalHeight > window.innerHeight * 3;
    this.years = [];
    let lastY = -Infinity;
    for (const m of this.months) {
      const year = m.month.substring(0, 4);
      if (this.years.length && this.years[this.years.length - 1].year === year) {
        continue;
      }
      const y = Math.min(1, (this.containerTop() + m.top) / max) * trackHeight;
      if (y - lastY < 20) {
        // too close to the previous label: keep the year for the bubble only
        this.years.push({year, y: null});
        continue;
      }
      this.years.push({year, y});
      lastY = y;
    }
    this.years = this.years.filter(y => y.y !== null);
  }

  private scheduleUpdate(): void {
    if (this.updateScheduled) {
      return;
    }
    this.updateScheduled = true;
    requestAnimationFrame(() => {
      this.updateScheduled = false;
      this.update();
    });
  }

  /** Called on scroll (outside Angular): renders only what changed. */
  private update(): void {
    if (!this.months.length) {
      return;
    }
    const top = this.viewTop();
    const vh = window.innerHeight;
    const from = top - vh;
    const to = top + 2 * vh;

    const trackHeight = this.track.nativeElement.clientHeight;
    const handleY = Math.min(1, Math.max(0, PageHelper.ScrollY / this.maxScroll())) * trackHeight;
    const current = this.monthAt(top + 1);
    const bubble = current ? current.label : '';

    const visible = this.months.filter(m => m.top + m.height >= from && m.top <= to);
    const changed = Math.abs(from - this.visibleRange.from) > vh / 4 ||
      visible.length !== this.visibleMonths.length ||
      visible.some((m, i) => m !== this.visibleMonths[i]);

    this.zone.run(() => {
      this.handleY = handleY;
      this.bubble = bubble;
      this.activateScrubber();
      if (changed) {
        this.visibleRange = {from, to};
        this.visibleMonths = visible;
      }
    });
    this.scheduleLoad();
  }

  /**
   * Loads the visible months once scrolling has settled: dragging the
   * scrubber across years must not queue a search for every month crossed.
   */
  private scheduleLoad(): void {
    if (this.loadTimer) {
      clearTimeout(this.loadTimer);
    }
    this.loadTimer = window.setTimeout(() => {
      this.loadTimer = null;
      if (this.dragging) {
        return;
      }
      for (const m of this.visibleMonths) {
        if (!m.loaded && !this.requested.has(m.month)) {
          this.load(m);
        }
      }
    }, 150);
  }

  private load(m: MonthBlock): void {
    this.requested.add(m.month);
    const filter = this.filter;
    this.timelineService.getMonth(m.month, filter)
      .then(media => this.zone.run(() => {
        if (filter === this.filter) { // not a stale answer for another filter
          this.fill(m, media);
        }
      }))
      .catch(console.error)
      .finally(() => this.requested.delete(m.month));
  }

  private fill(m: MonthBlock, media: MediaDTO[]): void {
    const byDay = new Map<string, Tile[]>();
    for (const md of media) {
      const key = TimelineService.dayKey(md);
      if (!byDay.has(key)) {
        byDay.set(key, []);
      }
      byDay.get(key).push({
        media: md,
        src: this.thumbnail(md),
        video: MediaDTOUtils.isVideo(md),
      });
    }
    for (const d of m.days) {
      // Never more tiles than counted: the layout height is fixed.
      d.tiles = (byDay.get(d.day) || []).slice(0, d.count);
    }
    m.loaded = true;
  }

  /** Smallest thumbnail covering the square tile (cropped by CSS). */
  private thumbnail(media: MediaDTO): string {
    const w = media.metadata.size?.width || 1;
    const h = media.metadata.size?.height || 1;
    const scale = this.tileSize / Math.min(w, h);
    return new Media(media, w * scale, h * scale).getThumbnailPath();
  }

  public dayVisible(m: MonthBlock, d: DayBlock): boolean {
    const top = m.top + d.top;
    return top + d.height >= this.visibleRange.from && top <= this.visibleRange.to;
  }

  public placeholders(d: DayBlock): number[] {
    return Array.from({length: d.tiles ? 0 : d.count}, (_, i) => i);
  }

  /**
   * After a bulk action: the timeline caches days and months, a reload is the simplest
   * way to show the change (the scroll position is kept across a reload).
   */
  public tileKey(t: Tile): string {
    return SelectionService.mediaKey(t.media);
  }

  public reloadPage(): void {
    this.timelineService.setScrollY(PageHelper.ScrollY, this.filter);
    window.location.reload();
  }

  public open(m: MonthBlock, tile: Tile): void {
    const media = tile.media;
    if (this.selection.active) {
      this.selection.toggleMedia(media);
      return;
    }
    this.timelineService.setScrollY(PageHelper.ScrollY, this.filter);
    const query = JSON.stringify(TimelineService.monthQuery(m.month, this.filter));
    this.lightboxService.backOnCloseUrl = '/search/' + query;
    this.router.navigate(['/search', query], {
      queryParams: {
        [QueryParams.gallery.photo]: Utils.concatUrls(media.directory.path, media.directory.name, media.name),
      },
    }).catch(console.error);
  }

  // --- scrubber -----------------------------------------------------------

  public onTrackDown(event: PointerEvent): void {
    this.dragging = true;
    this.track.nativeElement.setPointerCapture(event.pointerId);
    this.scrubTo(event.clientY);
    event.preventDefault();
  }

  public onTrackMove(event: PointerEvent): void {
    if (this.dragging) {
      this.scrubTo(event.clientY);
      event.preventDefault();
    }
  }

  public onTrackUp(event: PointerEvent): void {
    this.dragging = false;
    this.track.nativeElement.releasePointerCapture(event.pointerId);
    this.activateScrubber();
    this.scheduleLoad();
  }

  private scrubTo(clientY: number): void {
    const rect = this.track.nativeElement.getBoundingClientRect();
    const f = Math.min(1, Math.max(0, (clientY - rect.top) / rect.height));
    PageHelper.ScrollY = f * this.maxScroll();
  }

  private activateScrubber(): void {
    this.scrubberActive = true;
    if (this.scrubberTimer) {
      clearTimeout(this.scrubberTimer);
    }
    this.scrubberTimer = window.setTimeout(() => {
      if (!this.dragging) {
        this.scrubberActive = false;
        this.cd.detectChanges();
      }
    }, 1500);
  }

  // --- helpers ------------------------------------------------------------

  private containerTop(): number {
    return this.container.nativeElement.getBoundingClientRect().top + PageHelper.ScrollY;
  }

  /** Scroll position relative to the timeline container. */
  private viewTop(): number {
    return PageHelper.ScrollY - this.containerTop();
  }

  private maxScroll(): number {
    return Math.max(1, this.containerTop() + this.totalHeight - window.innerHeight);
  }

  private monthAt(y: number): MonthBlock {
    let lo = 0;
    let hi = this.months.length - 1;
    let res: MonthBlock = this.months[0];
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (this.months[mid].top <= y) {
        res = this.months[mid];
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    return res;
  }

  private capitalize(s: string): string {
    return s.charAt(0).toUpperCase() + s.slice(1);
  }

  trackMonth(_: number, m: MonthBlock): string {
    return m.month;
  }

  trackDay(_: number, d: DayBlock): string {
    return d.day;
  }

  trackTile(_: number, t: Tile): number {
    return t.media.id;
  }
}
