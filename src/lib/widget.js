define([
  './util',
  './webfinger',
  './wireClient',
  './sync',
  './schedule',
  './baseClient',
  './widget/default'
], function(util, webfinger, wireClient, sync, schedule, BaseClient, defaultView) {

  // Namespace: widget
  //
  // The remotestorage widget.
  //
  // See <remoteStorage.displayWidget>
  //

  "use strict";

  var settings = util.getSettingStore('remotestorage_widget');
  var events = util.getEventEmitter('ready', 'state');
  var logger = util.getLogger('widget');

  // the view.
  var view = defaultView;
  // options passed to displayWidget
  var widgetOptions = {};
  // passed to display() to avoid circular deps
  var remoteStorage;

  function setState(state) {
    view.setState.apply(view, arguments);
    events.emit('state', state);    
  }

  function buildScopeRequest() {
    return Object.keys(widgetOptions.scopes).map(function(module) {
      return (module === 'root' ? '' : module) + ':' + widgetOptions.scopes[module];
    }).join(' ');
  }

  function requestToken(authEndpoint) {
    logger.info('requestToken', authEndpoint);
    authEndpoint += authEndpoint.indexOf('?') > 0 ? '&' : '?';
    authEndpoint += [
      ['redirect_uri', document.location.href.split('#')[0]],
      ['scope', buildScopeRequest()],
      ['response_type', 'token']
    ].map(function(kv) {
      return kv[0] + '=' + encodeURIComponent(kv[1]);
    }).join('&');
    return view.redirectTo(authEndpoint);
  }

  function connectStorage(userAddress) {
    settings.set('userAddress', userAddress);
    return webfinger.getStorageInfo(userAddress).
      then(wireClient.setStorageInfo).
      get('properties').get('auth-endpoint').
      then(requestToken).
      then(schedule.enable, util.curry(setState, 'error'));
  }

  function reconnectStorage() {
    connectStorage(settings.get('userAddress'));
  }

  function disconnectStorage() {
    schedule.disable();
    remoteStorage.flushLocal();
    events.emit('state', 'disconnected');
  }

  // destructively parse query string from URI fragment
  function parseParams() {
    var md = String(document.location).match(/^(.*?)#(.*)$/);
    var result = {};
    if(md) {
      var hash = md[2];
      hash.split('&').forEach(function(param) {
        var kv = param.split('=');
        result[kv[0]] = decodeURIComponent(kv[1]);
      });
      document.location = md[1] + '#';
    }
    return result; 
  }

  function processParams() {
    var params = parseParams();

    // Query parameter: access_token
    if(params.access_token) {
      wireClient.setBearerToken(params.access_token);
    }
    // Query parameter: storage_root, storage_api
    if(params.storage_root && params.storage_api) {
      wireClient.setStorageInfo({
        type: params.storage_api,
        href: params.storage_root
      });
    }
    // Query parameter: authorize_endpoint
    if(params.authorize_endpoint) {
      requestToken(params.authorize_endpoint);
    }
    // Query parameter: user_address
    if(params.user_address) {
      view.setUserAddress(params.user_address);
    } else {
      var userAddress = settings.get('userAddress');
      if(userAddress) {
        view.setUserAddress(userAddress);
      }
    }
  }

  function handleSyncError(error) {
    if(error.message === 'unauthorized') {
      setState('unauthorized');
    } else {
      setState('error', error);
    }
  }

  function handleSyncTimeout() {
    schedule.disable();
    setState('offline');
  }

  function initialSync() {
    setState('busy', true);
    sync.forceSync().then(function() {
      schedule.enable();
      events.emit('ready');
    });
  }

  function display(_remoteStorage, domId, options) {
    remoteStorage = _remoteStorage;
    widgetOptions = options;
    if(! options) {
      options = {};
    }

    schedule.watch('/', 30000);

    view.display(domId, options);

    view.on('sync', sync.forceSync);
    view.on('connect', connectStorage);
    view.on('disconnect', disconnectStorage);
    view.on('reconnect', reconnectStorage);

    sync.on('busy', util.curry(setState, 'busy'));
    sync.on('ready', util.curry(setState, 'connected'));
    wireClient.on('connected', function() {
      setState('connected');
      initialSync();
    });
    wireClient.on('disconnected', util.curry(setState, 'initial'));

    BaseClient.on('error', util.curry(setState, 'error'));
    sync.on('error', handleSyncError);
    sync.on('timeout', handleSyncTimeout);

    processParams();

    wireClient.calcState();
  }
  
  return util.extend({
    display : display,

    clearSettings: settings.clear
  }, events);
});
