export const QueryParams = {
  gallery: {
    random: {
      directory: 'dir',
      recursive: 'recursive',
      orientation: 'orientation',
      fromDate: 'fromDate',
      toDate: 'toDate',
      minResolution: 'fromRes',
      maxResolution: 'toRes',
    },
    search: {
      type: 'type',
      query: 'qs',
    },
    map: {
      show: 'map'
    },
    timeline: {
      query: 'q', // search query filtering the timeline (e.g. a person)
    },
    photo: 'p',
    sharingKey_query: 'sk',
    sharingKey_params: 'sharingKey',
    directory: 'directory',
    knownLastModified: 'klm',
    knownLastScanned: 'kls',
    lightbox: {
      playback: 'play',
      captionAlwaysOn: 'cAO',
      controllersDimmed: 'cd',
      facesAlwaysOn: 'fAO',
      loopVideos: 'lv',
      loopSlideshow: 'ls',
      slideshowSpeed: 'ssp', // in seconds
      titles: {
        topLeftTitle: 'tlt',
        topLeftSubTitle: 'tlst',
        bottomLeftTitle: 'blt',
        bottomLeftSubTitle: 'blst',
      }
    },
    autoPollInterval: 'auInt',
  },
};
