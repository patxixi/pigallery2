import {ComponentFixture, TestBed} from '@angular/core/testing';
import {provideNoopAnimations} from '@angular/platform-browser/animations';
import {provideRouter} from '@angular/router';
import {NgIconsModule} from '@ng-icons/core';
import {
  ionChevronBackOutline,
  ionChevronForwardOutline,
  ionCloseOutline,
  ionContractOutline,
  ionExpandOutline,
  ionInformationOutline,
  ionMenuOutline,
  ionPauseOutline,
  ionPlayOutline,
} from '@ng-icons/ionicons';

import {ControlsLightboxComponent} from './controls.lightbox.gallery.component';
import {LightboxService} from '../lightbox.service';
import {FullScreenService} from '../../fullscreen.service';
import {AuthenticationService} from '../../../../model/network/authentication.service';
import {FileSizePipe} from '../../../../pipes/FileSizePipe';
import {DatePipe} from '@angular/common';

class MockLightboxService {
  controllersDimmed = false;
  slideshowSpeed = 5;
  captionAlwaysOn = false;
  facesAlwaysOn = false;
}

class MockFullScreenService {
  isFullScreenEnabled() {
    return false;
  }
}

class MockAuthenticationService {
  canSearch() {
    return false;
  }
}

describe('ControlsLightboxComponent - cursor visibility', () => {
  let component: ControlsLightboxComponent;
  let fixture: ComponentFixture<ControlsLightboxComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [
        ControlsLightboxComponent,
        NgIconsModule.withIcons({
          ionInformationOutline,
          ionContractOutline,
          ionExpandOutline,
          ionMenuOutline,
          ionCloseOutline,
          ionChevronBackOutline,
          ionChevronForwardOutline,
          ionPlayOutline,
          ionPauseOutline,
        }),
      ],
      providers: [
        {provide: LightboxService, useClass: MockLightboxService},
        {provide: FullScreenService, useClass: MockFullScreenService},
        {provide: AuthenticationService, useClass: MockAuthenticationService},
        {provide: FileSizePipe, useValue: {}},
        {provide: DatePipe, useValue: {}},
        provideNoopAnimations(),
        provideRouter([]),
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ControlsLightboxComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should hide the cursor while the controls are dimmed', () => {
    component.controllersDimmed = true;
    fixture.detectChanges();

    const swipeable: HTMLElement = fixture.nativeElement.querySelector('#swipeable-container');
    expect(swipeable).toBeTruthy();
    expect(swipeable.classList.contains('hide-cursor')).toBe(true);
  });

  it('should keep the cursor visible while the controls are shown', () => {
    component.controllersDimmed = false;
    fixture.detectChanges();

    const swipeable: HTMLElement = fixture.nativeElement.querySelector('#swipeable-container');
    expect(swipeable).toBeTruthy();
    expect(swipeable.classList.contains('hide-cursor')).toBe(false);
  });

  describe('extension media buttons', () => {
    const button = {
      name: 'add to favorites',
      apiPath: 'favorite',
      svgIcon: {viewBox: '0 0 10 10', items: '<path d="M0 0h10v10H0z"/>'},
    };
    let onMediaButtonClick: jasmine.Spy;

    beforeEach(() => {
      onMediaButtonClick = jasmine.createSpy('onMediaButtonClick');
      // Titles depend on the lightbox config, not under test here.
      spyOn(component as any, 'getText').and.returnValue('');
      const media = {name: 'a.jpg', metadata: {size: {width: 10, height: 10}, creationDate: 0}};
      component.activePhoto = {
        mediaButtons: [button],
        onMediaButtonClick,
        gridMedia: {
          media,
          Photo: media,
          isVideo: () => false,
          isPhoto: () => true,
          getOriginalMediaPath: () => '/a.jpg',
        },
      } as any;
      fixture.detectChanges();
    });

    it('should show the buttons of the active photo', () => {
      const buttons: HTMLElement[] = Array.from(fixture.nativeElement.querySelectorAll('.controls-top .media-button'));
      expect(buttons.length).toBe(1);
      expect(buttons[0].title).toBe('add to favorites');
      expect(buttons[0].querySelector('svg path')).toBeTruthy();
    });

    it('should run the button action of the active photo on click', () => {
      const el: HTMLElement = fixture.nativeElement.querySelector('.controls-top .media-button');
      el.click();
      expect(onMediaButtonClick).toHaveBeenCalledTimes(1);
      expect(onMediaButtonClick.calls.mostRecent().args[0]).toBe(button);
    });
  });
});
