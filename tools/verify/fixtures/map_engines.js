/* Deterministic camera doubles for era_camera.py.
 * Production 35-map.js still creates the engine, renders data and binds controls.
 * These implement its used public APIs and record every camera-changing method;
 * they deliberately do not emulate WebGL, tile rendering or camera animations.
 */
(function () {
  'use strict';
  const fixture = window.__cameraFixture = { map: null, calls: [] };
  const bounds = (west, south, east, north) => ({
    getWest: () => west, getSouth: () => south,
    getEast: () => east, getNorth: () => north,
    isValid: () => Number.isFinite(west)
  });
  function pointBounds(points) {
    return bounds(Math.min(...points.map(p => p[0])), Math.min(...points.map(p => p[1])),
      Math.max(...points.map(p => p[0])), Math.max(...points.map(p => p[1])));
  }
  class Camera {
    constructor(options, leaflet) {
      this.leaflet = leaflet;
      this.center = leaflet ? options.center.slice().reverse() : options.center.slice();
      this.zoom = options.zoom;
      this.pitch = options.pitch || 0;
      this.bearing = options.bearing || 0;
      this.events = {};
      fixture.map = this;
    }
    on(event, listener) { (this.events[event] ||= []).push(listener); return this; }
    emit(event) { (this.events[event] || []).forEach(listener => listener({})); }
    move(method, options) {
      fixture.calls.push(method);
      if (options.center) this.center = options.center.slice();
      ['zoom', 'pitch', 'bearing'].forEach(key => {
        if (options[key] !== undefined) this[key] = options[key];
      });
      this.emit('zoom'); this.emit('moveend');
      return this;
    }
    getCenter() { return { lng: this.center[0], lat: this.center[1] }; }
    getZoom() { return this.zoom; }
    getPitch() { return this.pitch; }
    getBearing() { return this.bearing; }
    getBounds() {
      const half = 0.12 * Math.pow(2, 12 - this.zoom);
      return bounds(this.center[0] - half, this.center[1] - half,
        this.center[0] + half, this.center[1] + half);
    }
    fitBounds(input, options) {
      options ||= {};
      const b = Array.isArray(input) ? pointBounds(input) : input;
      return this.move('fitBounds', {
        center: [(b.getWest() + b.getEast()) / 2, (b.getSouth() + b.getNorth()) / 2],
        zoom: options.maxZoom || 13,
        pitch: options.pitch, bearing: options.bearing
      });
    }
    zoomIn() { return this.move('zoomIn', { zoom: this.zoom + 1 }); }
    zoomOut() { return this.move('zoomOut', { zoom: this.zoom - 1 }); }
    setView(latlng, zoom) { return this.move('setView', { center: latlng.slice().reverse(), zoom }); }
    easeTo(options) { return this.move('easeTo', options); }
    flyTo(options) { return this.move('flyTo', options); }
    jumpTo(options) { return this.move('jumpTo', options); }
    resize() { return this; }
    invalidateSize() { return this; }
    remove() { return this; }
  }
  fixture.seed = camera => {
    if (fixture.map.leaflet) fixture.map.setView(camera.center.slice().reverse(), camera.zoom);
    else fixture.map.jumpTo(camera);
    fixture.calls = [];
  };
  fixture.snapshot = () => ({
    camera: { center: fixture.map.center.slice(), zoom: fixture.map.zoom,
      pitch: fixture.map.pitch, bearing: fixture.map.bearing },
    calls: fixture.calls.slice()
  });
  if (window.__cameraEngine === 'maplibre') {
    class MapDouble extends Camera {
      constructor(options) {
        super(options, false);
        this.container = options.container;
        this.sources = {};
        this.layers = {};
        setTimeout(() => this.emit('load'), 0);
      }
      addSource(id, definition) {
        this.sources[id] = { data: definition.data, setData(data) { this.data = data; } };
      }
      getSource(id) { return this.sources[id]; }
      addLayer(definition) { this.layers[definition.id] = definition; }
      getLayer(id) { return this.layers[id]; }
      getStyle() { return { sources: {}, layers: Object.values(this.layers) }; }
      getContainer() { return this.container; }
      queryRenderedFeatures() { return []; }
      setPaintProperty() {}
    }
    class MarkerDouble {
      constructor(options) { this.element = options.element; }
      setLngLat() { return this; }
      addTo() { return this; }
      getElement() { return this.element; }
      remove() { return this; }
    }
    window.maplibregl = { Map: MapDouble, Marker: MarkerDouble, supported: () => true };
  } else {
    window.L = {
      map: (element, options) => new Camera(options, true),
      tileLayer: () => ({ addTo() { return this; } }),
      featureGroup: () => ({
        circles: [], addTo() { return this; }, clearLayers() { this.circles = []; },
        getBounds() { return pointBounds(this.circles.map(circle => circle.latlng.slice().reverse())); }
      }),
      circle: latlng => ({
        latlng, bindTooltip() { return this; }, on() { return this; },
        addTo(group) { group.circles.push(this); return this; }
      })
    };
  }
})();
