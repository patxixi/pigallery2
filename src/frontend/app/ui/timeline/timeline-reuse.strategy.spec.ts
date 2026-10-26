import {Injector} from '@angular/core';
import {ActivatedRouteSnapshot, DetachedRouteHandle, Router} from '@angular/router';
import {TimelineReuseStrategy} from './timeline-reuse.strategy';

describe('TimelineReuseStrategy', () => {
  let strategy: TimelineReuseStrategy;
  let trigger: string;
  const route = (path: string, queryParams = {}): ActivatedRouteSnapshot =>
    ({routeConfig: {path}, queryParams} as unknown as ActivatedRouteSnapshot);
  const handle = (): DetachedRouteHandle & { componentRef: { destroy: jasmine.Spy } } =>
    ({componentRef: {destroy: jasmine.createSpy('destroy')}});

  beforeEach(() => {
    trigger = 'popstate';
    const router = {getCurrentNavigation: () => ({trigger})} as unknown as Router;
    strategy = new TimelineReuseStrategy({get: () => router} as unknown as Injector);
    TimelineReuseStrategy.keepNext = false;
  });

  it('should keep the timeline only when it opens a photo', () => {
    expect(strategy.shouldDetach(route('timeline'))).toBeFalse();
    TimelineReuseStrategy.keepNext = true;
    expect(strategy.shouldDetach(route('albums'))).toBeFalse();
    expect(strategy.shouldDetach(route('timeline'))).toBeTrue();
    // once
    expect(strategy.shouldDetach(route('timeline'))).toBeFalse();
  });

  it('should give it back when going back to the same timeline', () => {
    const h = handle();
    strategy.store(route('timeline', {q: 'x'}), h);
    expect(strategy.shouldAttach(route('timeline', {q: 'x'}))).toBeTrue();
    expect(strategy.retrieve(route('timeline', {q: 'x'}))).toBe(h);
    strategy.store(route('timeline', {q: 'x'}), null);
    expect(strategy.retrieve(route('timeline'))).toBeNull();
    expect(h.componentRef.destroy).not.toHaveBeenCalled();
  });

  it('should build a new timeline (and drop the kept one) on any other way to it', () => {
    const h = handle();
    strategy.store(route('timeline', {q: 'x'}), h);
    expect(strategy.shouldAttach(route('albums'))).toBeFalse();
    expect(h.componentRef.destroy).not.toHaveBeenCalled();
    trigger = 'imperative';
    expect(strategy.shouldAttach(route('timeline', {q: 'x'}))).toBeFalse();
    expect(h.componentRef.destroy).toHaveBeenCalled();
    expect(strategy.retrieve(route('timeline'))).toBeNull();
  });

  it('should not give back a timeline of another filter', () => {
    const h = handle();
    strategy.store(route('timeline', {q: 'x'}), h);
    expect(strategy.shouldAttach(route('timeline', {q: 'y'}))).toBeFalse();
    expect(h.componentRef.destroy).toHaveBeenCalled();
  });
});
