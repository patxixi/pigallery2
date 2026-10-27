import {BehaviorSubject} from 'rxjs';
import {MediaButtonModalComponent} from './media-button-modal.component';
import {MediaButtonModalData, MediaButtonModalService} from './media-button-modal.service';
import {NetworkService} from '../../../../../model/network/network.service';

describe('MediaButtonModalComponent suggestions', () => {
  const button = {
    name: 'album',
    apiPath: 'album',
    extensionBasePath: '/extension/etiquettes',
    svgIcon: {viewBox: '', items: ''},
    popup: {
      customFields: [
        {id: 'album', type: 'string', label: 'Album', suggestionsApiPath: 'albums'},
        {id: 'note', type: 'string', label: 'Note'},
      ],
    },
  } as any;

  const open = async (getJson: (url: string) => Promise<unknown>): Promise<{ component: MediaButtonModalComponent, urls: string[] }> => {
    const urls: string[] = [];
    const data = new BehaviorSubject<MediaButtonModalData>({button, media: null, visible: true});
    const service = {modalData: data.asObservable(), getValue: (): undefined => undefined} as unknown as MediaButtonModalService;
    const network = {
      getJson: (url: string) => {
        urls.push(url);
        return getJson(url);
      }
    } as unknown as NetworkService;
    const component = new MediaButtonModalComponent(service, network);
    component.ngOnInit();
    await new Promise((r) => setTimeout(r));
    return {component, urls};
  };

  it('should fetch the suggestions of the fields that have a route', async () => {
    const {component, urls} = await open(() => Promise.resolve(['Noël', 'Vacances']));
    expect(urls).toEqual(['/extension/etiquettes/albums']);
    expect(component.suggestions).toEqual({album: ['Noël', 'Vacances']});
    component.ngOnDestroy();
  });

  it('should keep a plain field when the route fails', async () => {
    spyOn(console, 'error');
    const {component} = await open(() => Promise.reject(new Error('offline')));
    expect(component.suggestions).toEqual({});
    expect(component.formData.customFields).toEqual({album: '', note: ''});
    component.ngOnDestroy();
  });
});
