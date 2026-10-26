import {Injectable, Injector} from '@angular/core';
import {ActivatedRouteSnapshot, BaseRouteReuseStrategy, DetachedRouteHandle, Router} from '@angular/router';

/**
 * Keeps the timeline alive while a photo opened from it is shown: the
 * lightbox lives on a search page, and closing it goes back in history.
 * Without this the timeline was built again (empty tiles, then every
 * thumbnail again); now the same one comes back as it was.
 * Only for that back navigation: any other way to the timeline builds a new
 * one, and the kept one is dropped.
 */
@Injectable()
export class TimelineReuseStrategy extends BaseRouteReuseStrategy {
  /** Set by the timeline just before it opens a photo. */
  public static keepNext = false;
  private stored: { handle: DetachedRouteHandle; params: string } = null;

  // The Router needs this strategy: it is looked up only when used.
  constructor(private injector: Injector) {
    super();
  }

  private static isTimeline(route: ActivatedRouteSnapshot): boolean {
    return route.routeConfig?.path === 'timeline';
  }

  private static key(route: ActivatedRouteSnapshot): string {
    return JSON.stringify(route.queryParams);
  }

  override shouldDetach(route: ActivatedRouteSnapshot): boolean {
    if (!TimelineReuseStrategy.isTimeline(route)) {
      return false;
    }
    const keep = TimelineReuseStrategy.keepNext;
    TimelineReuseStrategy.keepNext = false;
    return keep;
  }

  override store(route: ActivatedRouteSnapshot, handle: DetachedRouteHandle | null): void {
    if (!handle) {
      // the router took the kept timeline back
      this.stored = null;
      return;
    }
    this.discard();
    this.stored = {handle, params: TimelineReuseStrategy.key(route)};
  }

  override shouldAttach(route: ActivatedRouteSnapshot): boolean {
    if (!this.stored || !TimelineReuseStrategy.isTimeline(route)) {
      return false;
    }
    const back = this.injector.get(Router).getCurrentNavigation()?.trigger === 'popstate';
    if (back && this.stored.params === TimelineReuseStrategy.key(route)) {
      return true;
    }
    this.discard();
    return false;
  }

  override retrieve(route: ActivatedRouteSnapshot): DetachedRouteHandle | null {
    return this.stored && TimelineReuseStrategy.isTimeline(route) ? this.stored.handle : null;
  }

  private discard(): void {
    (this.stored?.handle as { componentRef?: { destroy(): void } })?.componentRef?.destroy();
    this.stored = null;
  }
}
