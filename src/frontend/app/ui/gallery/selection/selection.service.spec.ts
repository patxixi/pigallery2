import {SelectionService} from './selection.service';
import {MediaDTO} from '../../../../../common/entities/MediaDTO';
import {UserRoles} from '../../../../../common/entities/UserDTO';

describe('SelectionService', () => {
  const media = (dir: string, name: string): MediaDTO => ({
    name,
    directory: {path: dir.slice(0, dir.lastIndexOf('/') + 1) || './', name: dir.slice(dir.lastIndexOf('/') + 1)},
  } as unknown as MediaDTO);

  const button = (extra: Record<string, unknown>) => ({
    name: 'b',
    apiPath: 'one',
    bulk: true,
    extensionBasePath: '/pgapi/extension/x',
    svgIcon: {viewBox: '', items: ''},
    ...extra,
  } as any);

  let posted: [string, any][];
  let service: SelectionService;

  beforeEach(() => {
    posted = [];
    const network = {
      postJson: (url: string, data: any) => {
        posted.push([url, data]);
        return Promise.resolve();
      }
    };
    const extensions = {
      UIExtensionConfig: [{
        extensionBasePath: '/pgapi/extension/x',
        mediaButtons: [
          {name: 'tile only', apiPath: 'a', svgIcon: {viewBox: '', items: ''}},
          {name: 'bulk', apiPath: 'b', bulk: true, svgIcon: {viewBox: '', items: ''}},
          {name: 'admin bulk', apiPath: 'c', bulk: true, minUserRole: UserRoles.Admin, svgIcon: {viewBox: '', items: ''}},
        ]
      }]
    };
    const auth = {isAuthorized: (role: UserRoles) => role <= UserRoles.User};
    service = new SelectionService(extensions as any, auth as any, network as any);
  });

  it('should toggle media and directories', () => {
    const m = media('2024/05', 'a.jpg');
    service.toggleMedia(m);
    service.toggleDirectory('2024/06');
    expect(service.isMediaSelected(m)).toBe(true);
    expect(service.count).toBe(2);
    service.toggleMedia(m);
    expect(service.isMediaSelected(m)).toBe(false);
    service.stop();
    expect(service.count).toBe(0);
  });

  it('should only offer bulk buttons the user may use', () => {
    expect(service.bulkButtons.map(b => b.name)).toEqual(['bulk']);
  });

  it('should call the bulk route once with the whole selection', async () => {
    service.toggleMedia(media('2024/05', 'a.jpg'));
    service.toggleDirectory('2024/06');
    const r = await service.run(button({bulkApiPath: 'lot'}), {customFields: {k: 1}});
    expect(posted.length).toBe(1);
    expect(posted[0][0]).toBe('/pgapi/extension/x/lot');
    expect(posted[0][1].media).toEqual(['2024/05/a.jpg']);
    expect(posted[0][1].directories).toEqual(['2024/06']);
    expect(r.failed).toEqual([]);
  });

  it('should call the media route once per media without a bulk route', async () => {
    service.toggleMedia(media('2024/05', 'a.jpg'));
    service.toggleMedia(media('2024/05', 'b.jpg'));
    const r = await service.run(button({}));
    expect(posted.map(p => p[1].media)).toEqual(['2024/05/a.jpg', '2024/05/b.jpg']);
    expect(r.done).toBe(2);
  });

  it('should not run a media-by-media button on directories', () => {
    service.toggleDirectory('2024/06');
    expect(service.canRun(button({}))).toBe(false);
    expect(service.canRun(button({bulkApiPath: 'lot'}))).toBe(true);
  });
});
