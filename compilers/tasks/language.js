module.exports = function(grunt, options) {

  'use strict';

  var fs = require('fs');
  var path = require('path');
  var util = require('util');

  var langMetaData = require('../lib/languages-metadata');
  var enabledLanguages = {};
  var enabledLabels = {};

  var suffixRegExp = /\/Localizable\.strings$/;
  var lineParsingRegExp = /^\s*\"([a-zA-Z0-9_\-\$]+)\"\s*=\s*\"(.*)\";\s*$/;
  var template = "define(function() {\nreturn {\n'name': '%s',\n'data': %s\n};\n});";

  function resolveLangCode (langCode) {

    // GetLocalization doesn't follow ISO codes, fix the names
    langCode = langCode.replace(/\-/g, '_');

    var metaData = langMetaData[langCode];
    while (metaData && metaData.alias) {
      langCode = metaData.alias;
      metaData = langMetaData[langCode];
    }

    // if there is no metadata for this language, then drop out
    if(!metaData) {
      grunt.fatal('Language missing:' + langCode);
    }

    return {
      'code': langCode,
      'data': metaData
    };
  }

  function fileToCode (file, options) {
    var prefixRegexp = new RegExp('^' + options.src + '/');
    return file.replace(prefixRegexp, '').replace(suffixRegExp, '');
  }

  function name (file, options) {
    var langCode = fileToCode(file, options);
    var resolved = resolveLangCode(langCode);
    return resolved.data.file;
  }

  function compile (rawLanguageData, options, callback) {

    var json = {};
    rawLanguageData.split(/[\r\n]+/).forEach(function(line) {

      var sections = line.match(lineParsingRegExp);
      if (sections && sections.length >= 2 && !sections[1].match(/\s/)) {

        var key = sections[1];
        if (!(enabledLabels[key])) { // TODO: how to handle momentjs ?? && !key.match(/^momentjs_/)) {
          return;
        }

        var value = sections[2];
        value = value.replace(/%(([0-9]+)\$)?@/g, function(x, y, num) {
          return '$' + (num || '');
        }).replace(/\\\"/g, '"');

        json[key] = value;
      }
    });

    callback(null, JSON.stringify(json));
  }

  function compileAvailable(err, languages, options, done) {

    var available = {};

    // Generate a map of available & enabled languages
    languages.forEach(function(lang) {

      var langCode = fileToCode(lang.file, options);
      var resolved = resolveLangCode(langCode);
      var metaData = resolved.data;
      langCode = resolved.code;

      // Skip disabled languages
      if(!enabledLanguages[langCode]) {
        return;
      }

      available[langCode] = {
        "file": metaData.file,
        "name": metaData.name
      };

      // Add directiorn info for rtl languages
      if(metaData.dir) {
        available[langCode].dir = metaData.dir;
      }
    });

    // Copy over all the enabled aliases
    // var _ = grunt.util._;
    // _.each(enabledLanguages, function(lang, code) {
    //   if(lang.alias && lang.alias in available) {
    //     available[code] = {
    //       'alias': lang.alias
    //     };
    //   }
    // });

    var destFilePath = path.join(options.destPath, 'available.js');
    var module = util.format(template, 'available', JSON.stringify(available));
    fs.writeFile(destFilePath, module, function() {
      grunt.log.debug('\u2713', 'languages/available');
      done();
    });
  }

  var BaseCompileTask = require('../lib/base-compiler');
  function LanguageCompileTask() {

    var options = this.options({
      'languages': ['en']
    });

    // pre-populate the available-languages map
    if(options.languages.length) {
      options.languages.forEach(function (langCode) {
        var resolved = resolveLangCode(langCode);
        enabledLanguages[resolved.code] = resolved.data;
      });
    }

    // pre-populate the valid-labels map
    if(options.labels) {
      var labelsFilePath = path.resolve(options.labels);

      var exists = fs.existsSync(labelsFilePath);
      if(!exists) {
        grunt.fatal('languages: ' + labelsFilePath + ' does not exists');
      }

      var labels = fs.readFileSync(labelsFilePath).toString();
      labels = labels.split(/[\n\r\t\s]/g);
      labels.forEach(function(label) {
        enabledLabels[label] = true;
      });
    }

    BaseCompileTask.call(this, grunt, {
      'name': name,
      'template': template,
      'compile': compile,
      'options': {
        'src': 'public/languages/strings',
        'dest': 'build/languages',
        'glob': '**/Localizable.strings',
        'languages': ['en']
      }
    }, compileAvailable);
  }

  grunt.registerTask('compile/languages', 'Compile localization data as AMD modules', LanguageCompileTask);
};