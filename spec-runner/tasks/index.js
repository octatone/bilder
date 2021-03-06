module.exports = function (grunt) {

  'use strict';

  var vm = require('vm');
  var fs = require('fs');
  var path = require('path');

  var jsdom = require('jsdom');
  var jqLoader = require('jquery-loader');
  var chai = require('chai');
  var sinon = require('sinon');
  var Mocha = require('mocha');
  var requirejs = require('requirejs');
  var istanbul = require('istanbul');

  var define = requirejs.define;
  var _ = grunt.util._;
  var glob = grunt.file.glob;

  var isTravis = (process.env.TRAVIS === 'true');

  // Dummies/Mocks for require.js to work
  function noop() { return {}; }
  function fakeLoader(a, b, load) { load(noop); }

  // Instrument files for coverage
  var oldRequireJSLoader = requirejs.load;
  var makeNodeWrapper = requirejs.makeNodeWrapper;
  var exists = fs.existsSync || path.existsSync;
  function instrumentModule (options) {

    return function (context, moduleName, url) {

      options.files = options.files || [];

      // skip files not marked for coverage & other plugin schtuff
      if(options.files.indexOf(url) === -1 || !exists(url)) {
        return oldRequireJSLoader.call(requirejs, context, moduleName, url);
      }

      // Load file from FS,
      var contents = fs.readFileSync(url, 'utf8');

      // Instrument the code
      var instrumenter = new istanbul.Instrumenter();
      contents = instrumenter.instrumentSync(contents, url);

      // Wrap it for node.js
      contents = makeNodeWrapper(contents);

      // execute it in the context of requirejs
      try {
        vm.runInThisContext(contents, fs.realpathSync(url));
      } catch (e) {
         throw new Error('Failed loading module "' + moduleName + '" with error: ' + e);
      }

      // mark module as loaded
      context.completeLoad(moduleName);
    };
  }

  // patch the context with some globals & stuff
  function patchMochaContext (mocha) {

    mocha.suite.on('pre-require', function(context) {

      // use a fresh new dom for every test
      var win = jsdom.jsdom().createWindow('<!doctype html><body/>');
      win.navigator = context.navigator = {
        'userAgent': 'Bilder Test Runner',
        'appVersion': '1.0.0'
      };

      var $ = jqLoader.create(win, '1.10.1');

      // enhance chai's flavour
      chai.use(require('sinon-chai'));

      // Attach globals to all the contexts
      function fixContext(ctx) {

        // Augment BOM
        ctx.window = win;
        ctx.document = win.document;

        ctx.$ = ctx.window.$ = $;

        // make "requirejs" a global in specs running in nodejs
        ctx.requirejs = ctx.require = requirejs;
        ctx.nodeRequire = require;

        // make chai functions available
        ctx.should = chai.should();
        ctx.expect = chai.expect;

        // make sinon available
        ctx.sinon = sinon;

        // manually load sinon's fake xhr module
        // TODO: is this really the best way to load it?
        require('sinon/lib/sinon/util/fake_xml_http_request');

        // make requirejs methods available
        ctx.define = define;

        // Let specs use underscore
        ctx._ = _;

        // Specs are in nodejs
        ctx.isNode = true;

        // Specs are on travis
        ctx.isTravis = isTravis;
      }

      // fix the main suite context first
      fixContext(context);

      // also make all this stuff available on beforeEach of these suites
      mocha.suite.on('suite', function(suite) {
        suite.on('beforeEach', function(hook) {
          fixContext(hook.ctx);
        });
      });
    });
  }

  grunt.registerTask('specs/mocha', 'Node based spec-runner for mocha', function () {

    var options = this.options({
      'base': '',
      'glob': '**/*.spec.js',
      'ui': 'bdd',
      'reporter': 'spec',
      'globals': ['_', '$'],
      'require': {
        'base': 'public'
      },
      'mocks': {},
      'fake_plugins': [],
      'fake_modules': [],
      'coverage': {}
    });

    // Stub requirejs plugins
    options.fake_plugins.forEach(function (pluginName) {
      define(pluginName, { 'load': fakeLoader });
    });

    // Fake some requirejs modules
    options.fake_modules.forEach(function (pluginName) {
      define(pluginName, noop);
    });

    // Async task here
    var done = this.async();

    // Create a new spec-runner
    var mocha = new Mocha();

    // Allow certain globals in mocha
    mocha.globals(options.globals);

    // Configure Mocha UI & Reporter
    mocha.ui(options.ui);
    mocha.reporter(options.reporter);

    // Make mock paths absolute
    var mocks = options.mocks || {};
    var paths = mocks.paths || {};
    if(mocks.base && paths) {
      Object.keys(paths).forEach(function(name) {
        paths[name] = path.resolve(options.base, mocks.base, paths[name]);
      });
    }

    // find modules in the app folder
    requirejs.config({
      'baseUrl': path.resolve(options.base, options.require.base),
      'paths': paths
    });

    // Make paths absolute for files marked for coverage
    if(options.coverage.files) {
      var globRules = options.coverage.files;
      var files = [];
      globRules.forEach(function(rule) {
        rule = path.resolve(options.base, options.require.base, rule);
        files.push.apply(files, glob.sync(rule));
      });
      options.coverage.files = files;
    }

    // Override requirejs.load for coverage generation
    if (options.coverage.files) {
      requirejs.load = instrumentModule(options.coverage);
    }

    // Path the context
    patchMochaContext(mocha);

    // populate files
    var globRule = path.resolve(options.base, options.glob);
    mocha.files = glob.sync(globRule);

    // add support for grepping specs
    if (this.args.length && mocha.files.length) {
      mocha.grep(this.args[0]);
    }

    // Run it
    mocha.run(function (count) {

      // Stop fataly on any failed specs
      if(count) {
        grunt.fatal(count + ' failures.');
      } else if (global.__coverage__) {

        // Process the coverage
        var collector = new istanbul.Collector();
        collector.add(global.__coverage__);

        // Generate the report
        ['text-summary', 'html'].forEach(function (type) {
          istanbul.Report.create(type, {
            'dir': options.coverage.output_dir || ''
          }).writeReport(collector, true);
        });
      }

      done();
    });

  });
};
