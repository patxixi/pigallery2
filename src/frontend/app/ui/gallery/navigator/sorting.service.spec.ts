import {DatePipe} from '@angular/common';
import {BehaviorSubject, firstValueFrom} from 'rxjs';
import {GallerySortingService} from './sorting.service';
import {GalleryCacheService} from '../cache.gallery.service';
import {ContentLoaderService, DirectoryContent} from '../contentLoader.service';
import {SeededRandomService} from '../../../model/seededRandom.service';
import {ContentWrapperWithError} from '../../../../../common/entities/ContentWrapper';
import {SearchQueryTypes, TextSearch} from '../../../../../common/entities/SearchQueryDTO';
import {GroupByTypes, SortByTypes} from '../../../../../common/entities/SortingMethods';
import {PhotoDTO} from '../../../../../common/entities/PhotoDTO';

describe('GallerySortingService', () => {
  const photo = (name: string, creationDate: number): PhotoDTO =>
    ({name, metadata: {creationDate}} as unknown as PhotoDTO);
  // the order of a content search: the best match first, not by date
  const media = [photo('best.jpg', 1000), photo('second.jpg', 3000), photo('third.jpg', 2000)];
  const searchResult = (query: unknown) => ({
    searchResult: {searchQuery: query, media: [...media], directories: [], metaFile: []}
  } as unknown as ContentWrapperWithError);

  let content: BehaviorSubject<ContentWrapperWithError>;
  let service: GallerySortingService;

  beforeEach(() => {
    content = new BehaviorSubject<ContentWrapperWithError>(null);
    const cache = {getSorting: (): null => null, getGrouping: (): null => null} as unknown as GalleryCacheService;
    service = new GallerySortingService(cache, {content} as unknown as ContentLoaderService,
      new SeededRandomService(), new DatePipe('en'));
  });

  it('should keep the server order of a content search', async () => {
    content.next(searchResult({type: SearchQueryTypes.content, value: 'turtle'} as TextSearch));
    expect(service.sorting.value.method).toBe(SortByTypes.Relevance);
    expect(service.grouping.value.method).toBe(GroupByTypes.NoGrouping);
    const sorted = await firstValueFrom(service.applySorting(new BehaviorSubject<DirectoryContent>(
      {media: [...media], directories: [], metaFile: []})));
    expect(sorted.mediaGroups.length).toBe(1);
    expect(sorted.mediaGroups[0].media.map(m => m.name)).toEqual(['best.jpg', 'second.jpg', 'third.jpg']);
  });

  it('should sort other searches as configured', () => {
    content.next(searchResult({type: SearchQueryTypes.any_text, value: 'turtle'} as TextSearch));
    expect(service.sorting.value.method).not.toBe(SortByTypes.Relevance);
    content.next(searchResult({type: SearchQueryTypes.content, value: 'turtle', negate: true} as TextSearch));
    expect(service.sorting.value.method).not.toBe(SortByTypes.Relevance);
  });
});
