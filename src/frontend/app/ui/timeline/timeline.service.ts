import {Injectable} from '@angular/core';
import {NetworkService} from '../../model/network/network.service';
import {TimelineDTO} from '../../../../common/entities/TimelineDTO';
import {MediaDTO} from '../../../../common/entities/MediaDTO';
import {ANDSearchQuery, DateSearch, SearchQueryDTO, SearchQueryTypes} from '../../../../common/entities/SearchQueryDTO';
import {ContentWrapperUtils, PackedContentWrapperWithError} from '../../../../common/entities/ContentWrapper';
import {Config} from '../../../../common/config/public/Config';
import {Utils} from '../../../../common/Utils';
import {QueryParams} from '../../../../common/QueryParams';

/**
 * Data of the timeline view. Kept for the whole session (singleton), so that
 * coming back from the lightbox does not reload anything and the scroll
 * position can be restored.
 */
@Injectable({providedIn: 'root'})
export class TimelineService {
  /**
   * Window scroll position when the timeline was left. Also kept in the
   * session storage, so a page reload (e.g. after an action on the photos)
   * comes back to the same place.
   */
  private static readonly SCROLL_KEY = 'timeline-scroll-y';

  public getScrollY(filter: SearchQueryDTO = null): number {
    try {
      return parseInt(sessionStorage.getItem(TimelineService.scrollKey(filter)), 10) || 0;
    } catch (e) {
      return 0;
    }
  }

  public setScrollY(value: number, filter: SearchQueryDTO = null): void {
    try {
      sessionStorage.setItem(TimelineService.scrollKey(filter), '' + Math.round(value));
    } catch (e) {
      // private mode or storage disabled: only lost after a reload
    }
  }

  private static scrollKey(filter: SearchQueryDTO): string {
    return TimelineService.SCROLL_KEY + (filter ? ':' + JSON.stringify(filter) : '');
  }

  /** Per filter ('' = whole gallery): day counts and loaded months. */
  private readonly days = new Map<string, { at: number, days: Promise<TimelineDTO> }>();
  private readonly months = new Map<string, Promise<MediaDTO[]>>();

  constructor(private networkService: NetworkService) {
  }

  /** Local day of a media, the same way the server counts it ('YYYY-MM-DD'). */
  public static dayKey(media: MediaDTO): string {
    let t = media.metadata.creationDate;
    if (Config.Gallery.ignoreTimestampOffset === true) {
      t += (Utils.getOffsetMinutes(media.metadata.creationDateOffset) || 0) * 60000;
    }
    return new Date(t).toISOString().substring(0, 10);
  }

  /**
   * Search query of a whole month ('YYYY-MM'), within the filter if any;
   * shared with the lightbox.
   */
  public static monthQuery(month: string, filter: SearchQueryDTO = null): SearchQueryDTO {
    const [y, m] = month.split('-').map(v => parseInt(v, 10));
    const range = {
      type: SearchQueryTypes.date,
      min: Date.UTC(y, m - 1, 1),
      max: Date.UTC(y, m, 1) - 1,
    } as DateSearch;
    if (!filter) {
      return range;
    }
    return {type: SearchQueryTypes.AND, list: [filter, range]} as ANDSearchQuery;
  }

  public getDays(filter: SearchQueryDTO = null): Promise<TimelineDTO> {
    const key = filter ? JSON.stringify(filter) : '';
    const cached = this.days.get(key);
    // Refreshed when older than 10 minutes (new photos).
    if (cached && Date.now() - cached.at < 10 * 60 * 1000) {
      return cached.days;
    }
    for (const k of Array.from(this.months.keys())) {
      if (k.startsWith(key + '|')) {
        this.months.delete(k);
      }
    }
    const days = this.networkService.getJson<TimelineDTO>('/timeline',
      filter ? {[QueryParams.gallery.timeline.query]: encodeURIComponent(key)} : undefined);
    days.catch((): void => {
      this.days.delete(key);
    });
    this.days.set(key, {at: Date.now(), days});
    return days;
  }

  /** Media of a month ('YYYY-MM'), newest first. */
  public getMonth(month: string, filter: SearchQueryDTO = null): Promise<MediaDTO[]> {
    const key = (filter ? JSON.stringify(filter) : '') + '|' + month;
    if (!this.months.has(key)) {
      const p = this.networkService
        .getJson<PackedContentWrapperWithError>('/search/' + encodeURIComponent(JSON.stringify(TimelineService.monthQuery(month, filter))))
        .then(cw => {
          const media = ContentWrapperUtils.unpack(cw)?.searchResult?.media || [];
          return media.sort((a, b) => b.metadata.creationDate - a.metadata.creationDate);
        });
      p.catch(() => this.months.delete(key));
      this.months.set(key, p);
    }
    return this.months.get(key);
  }
}
