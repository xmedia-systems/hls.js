typeof window !== "undefined" &&
(function webpackUniversalModuleDefinition(root, factory) {
	if(typeof exports === 'object' && typeof module === 'object')
		module.exports = factory();
	else if(typeof define === 'function' && define.amd)
		define([], factory);
	else if(typeof exports === 'object')
		exports["HlsPerformanceAnalyzer"] = factory();
	else
		root["HlsPerformanceAnalyzer"] = factory();
})(this, function() {
return /******/ (function(modules) { // webpackBootstrap
/******/ 	// The module cache
/******/ 	var installedModules = {};
/******/
/******/ 	// The require function
/******/ 	function __webpack_require__(moduleId) {
/******/
/******/ 		// Check if module is in cache
/******/ 		if(installedModules[moduleId]) {
/******/ 			return installedModules[moduleId].exports;
/******/ 		}
/******/ 		// Create a new module (and put it into the cache)
/******/ 		var module = installedModules[moduleId] = {
/******/ 			i: moduleId,
/******/ 			l: false,
/******/ 			exports: {}
/******/ 		};
/******/
/******/ 		// Execute the module function
/******/ 		modules[moduleId].call(module.exports, module, module.exports, __webpack_require__);
/******/
/******/ 		// Flag the module as loaded
/******/ 		module.l = true;
/******/
/******/ 		// Return the exports of the module
/******/ 		return module.exports;
/******/ 	}
/******/
/******/
/******/ 	// expose the modules object (__webpack_modules__)
/******/ 	__webpack_require__.m = modules;
/******/
/******/ 	// expose the module cache
/******/ 	__webpack_require__.c = installedModules;
/******/
/******/ 	// define getter function for harmony exports
/******/ 	__webpack_require__.d = function(exports, name, getter) {
/******/ 		if(!__webpack_require__.o(exports, name)) {
/******/ 			Object.defineProperty(exports, name, { enumerable: true, get: getter });
/******/ 		}
/******/ 	};
/******/
/******/ 	// define __esModule on exports
/******/ 	__webpack_require__.r = function(exports) {
/******/ 		if(typeof Symbol !== 'undefined' && Symbol.toStringTag) {
/******/ 			Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' });
/******/ 		}
/******/ 		Object.defineProperty(exports, '__esModule', { value: true });
/******/ 	};
/******/
/******/ 	// create a fake namespace object
/******/ 	// mode & 1: value is a module id, require it
/******/ 	// mode & 2: merge all properties of value into the ns
/******/ 	// mode & 4: return value when already ns object
/******/ 	// mode & 8|1: behave like require
/******/ 	__webpack_require__.t = function(value, mode) {
/******/ 		if(mode & 1) value = __webpack_require__(value);
/******/ 		if(mode & 8) return value;
/******/ 		if((mode & 4) && typeof value === 'object' && value && value.__esModule) return value;
/******/ 		var ns = Object.create(null);
/******/ 		__webpack_require__.r(ns);
/******/ 		Object.defineProperty(ns, 'default', { enumerable: true, value: value });
/******/ 		if(mode & 2 && typeof value != 'string') for(var key in value) __webpack_require__.d(ns, key, function(key) { return value[key]; }.bind(null, key));
/******/ 		return ns;
/******/ 	};
/******/
/******/ 	// getDefaultExport function for compatibility with non-harmony modules
/******/ 	__webpack_require__.n = function(module) {
/******/ 		var getter = module && module.__esModule ?
/******/ 			function getDefault() { return module['default']; } :
/******/ 			function getModuleExports() { return module; };
/******/ 		__webpack_require__.d(getter, 'a', getter);
/******/ 		return getter;
/******/ 	};
/******/
/******/ 	// Object.prototype.hasOwnProperty.call
/******/ 	__webpack_require__.o = function(object, property) { return Object.prototype.hasOwnProperty.call(object, property); };
/******/
/******/ 	// __webpack_public_path__
/******/ 	__webpack_require__.p = "/tests/performance/dist/";
/******/
/******/
/******/ 	// Load entry module and return exports
/******/ 	return __webpack_require__(__webpack_require__.s = "./tests/performance/performance-analyzer.ts");
/******/ })
/************************************************************************/
/******/ ({

/***/ "./tests/performance/performance-analyzer.ts":
/*!***************************************************************!*\
  !*** ./tests/performance/performance-analyzer.ts + 2 modules ***!
  \***************************************************************/
/*! no exports provided */
/***/ (function(module, __webpack_exports__, __webpack_require__) {

"use strict";
__webpack_require__.r(__webpack_exports__);

// CONCATENATED MODULE: ./tests/performance/cumulative-moving-average.ts
var CMA =
/*#__PURE__*/
function () {
  function CMA() {
    this.avg = 0;
    this.sampleCount = 0;
  }

  var _proto = CMA.prototype;

  _proto.update = function update(value) {
    this.avg = (value + this.sampleCount * this.avg) / (this.sampleCount + 1);
    this.sampleCount++;
  };

  return CMA;
}();


// CONCATENATED MODULE: ./tests/performance/LevelMeasurement.ts


var LevelMeasurement_LevelMeasurement =
/*#__PURE__*/
function () {
  function LevelMeasurement(level, index) {
    this.level = void 0;
    this.index = void 0;
    this.fragLoadCMA = new CMA();
    this.fragParseCMA = new CMA();
    this.fragBufferCMA = new CMA();
    this.fragTotalCMA = new CMA();
    this.firstBufferCMA = new CMA();
    this.chunkTransmuxCMA = new CMA();
    this.chunkTransmuxIdleCMA = new CMA();
    this.chunkVideoBufferCMA = new CMA();
    this.chunkVideoBufferIdleCMA = new CMA();
    this.chunkAudioBufferCMA = new CMA();
    this.chunkAudioBufferIdleCMA = new CMA();
    this.chunkSizeCMA = new CMA();
    this.level = level;
    this.index = index;
  }

  var _proto = LevelMeasurement.prototype;

  _proto.updateChunkMeasures = function updateChunkMeasures(meta, type) {
    var transmuxing = meta.transmuxing;
    var buffering = meta.buffering;
    this.chunkTransmuxCMA.update(transmuxing.end - transmuxing.start);
    var transmuxIdle = transmuxing.end - transmuxing.start - (transmuxing.executeEnd - transmuxing.executeStart);
    this.chunkTransmuxIdleCMA.update(transmuxIdle);

    if (type === 'video') {
      this.chunkVideoBufferCMA.update(buffering.video.end - buffering.video.start);
      this.chunkVideoBufferIdleCMA.update(buffering.video.executeStart - buffering.video.start);
    } else if (type === 'audio') {
      this.chunkAudioBufferCMA.update(buffering.audio.end - buffering.audio.start);
      this.chunkAudioBufferIdleCMA.update(buffering.audio.executeStart - buffering.audio.start);
    }

    if (meta.size) {
      this.chunkSizeCMA.update(meta.size);
    } // const statsString = (`Chunk stats:
    //   Average transmuxing time:        ${this.chunkTransmuxCMA.avg.toFixed(3)} ms
    //   Average transmux queue wait:     ${this.chunkTransmuxIdleCMA.avg.toFixed(3)} ms
    //
    //   Average video buffering time:    ${this.chunkVideoBufferCMA.avg.toFixed(3)} ms
    //   Average video buffer queue wait: ${this.chunkVideoBufferIdleCMA.avg.toFixed(3)} ms
    //
    // `);


    var statsString = "\n     " + this.chunkTransmuxCMA.avg.toFixed(3) + "\n     " + this.chunkTransmuxIdleCMA.avg.toFixed(3) + "\n     " + this.chunkVideoBufferCMA.avg.toFixed(3) + "\n     " + this.chunkVideoBufferIdleCMA.avg.toFixed(3) + "\n     " + this.chunkSizeCMA.avg.toFixed(3);
    document.querySelector('.stats-container .chunk').innerText = statsString;
  };

  _proto.updateFragmentMeasures = function updateFragmentMeasures(stats) {
    var loading = stats.loading;
    var parsing = stats.parsing;
    var buffering = stats.buffering;
    this.fragLoadCMA.update(loading.end - loading.start);
    this.fragParseCMA.update(parsing.end - parsing.start);
    this.fragBufferCMA.update(buffering.end - buffering.start);
    this.fragTotalCMA.update(buffering.end - loading.start);
    this.firstBufferCMA.update(buffering.first - loading.start); // const statsString = (`Level ${this.index} Stats:
    //   Average frag load time:             ${(this.fragLoadCMA.avg).toFixed(3)} ms
    //   Average frag parse time:            ${(this.fragParseCMA.avg).toFixed(3)} ms
    //   Average frag buffer time:           ${(this.fragBufferCMA.avg).toFixed(3)} ms
    //   Average total frag processing time: ${(this.fragTotalCMA.avg).toFixed(3)} ms
    // `);

    var statsString = "\n    " + this.fragLoadCMA.avg.toFixed(3) + "\n    " + this.fragParseCMA.avg.toFixed(3) + "\n    " + this.fragBufferCMA.avg.toFixed(3) + "\n    " + this.fragTotalCMA.avg.toFixed(3) + "\n    " + this.firstBufferCMA.avg.toFixed(3) + "\n    ";
    document.querySelector('.stats-container .frag').innerText = statsString;
  };

  return LevelMeasurement;
}();


// CONCATENATED MODULE: ./tests/performance/performance-analyzer.ts

var Hls = window.Hls;
var Events = Hls.Events;

var performance_analyzer_PerformanceAnalyzer =
/*#__PURE__*/
function () {
  function PerformanceAnalyzer(hls, mediaElement) {
    this.hls = void 0;
    this.mediaElement = void 0;
    this.listeners = [];
    this.levelAnalyzers = [];
    this.hls = hls;
    this.mediaElement = mediaElement;
    this.listeners = this.createListeners();
  }

  var _proto = PerformanceAnalyzer.prototype;

  _proto.setup = function setup(src, setPerformanceMarks) {
    if (setPerformanceMarks === void 0) {
      setPerformanceMarks = false;
    }

    var hls = this.hls,
        listeners = this.listeners,
        mediaElement = this.mediaElement;

    if (setPerformanceMarks) {
      this.setTriggerMarks();
    }

    listeners.forEach(function (l) {
      hls.on(l.name, l.fn);
    });
    hls.loadSource(src);
    hls.attachMedia(mediaElement);
  };

  _proto.destroy = function destroy() {
    var hls = this.hls,
        listeners = this.listeners;
    listeners.forEach(function (l) {
      hls.off(l.name, l.fn);
    });
  };

  _proto.setTriggerMarks = function setTriggerMarks() {
    var hls = this.hls;

    hls.trigger = function (event) {
      performance.mark(event + "-start");

      for (var _len = arguments.length, data = new Array(_len > 1 ? _len - 1 : 0), _key = 1; _key < _len; _key++) {
        data[_key - 1] = arguments[_key];
      }

      hls.emit.apply(hls, [event, event].concat(data));
      performance.mark(event + "-end");
      performance.measure("" + event, event + "-start", event + "-end");
    };
  };

  _proto.createListeners = function createListeners() {
    return [{
      name: Events.BUFFER_APPENDED,
      fn: this.onBufferAppended.bind(this)
    }, {
      name: Events.MANIFEST_PARSED,
      fn: this.onManifestParsed.bind(this)
    }, {
      name: Events.FRAG_BUFFERED,
      fn: this.onFragBuffered.bind(this)
    }];
  };

  _proto.onManifestParsed = function onManifestParsed(e, data) {
    var _this = this;

    var mediaElement = this.mediaElement;
    data.levels.forEach(function (level, i) {
      _this.levelAnalyzers.push(new LevelMeasurement_LevelMeasurement(level, i));
    });
    mediaElement.play();
  };

  _proto.onFragBuffered = function onFragBuffered(e, data) {
    var frag = data.frag,
        stats = data.stats;
    var levelAnalyzer = this.levelAnalyzers[frag.level];
    levelAnalyzer.updateFragmentMeasures(stats);
  };

  _proto.onBufferAppended = function onBufferAppended(e, data) {
    var chunkMeta = data.chunkMeta,
        type = data.type;
    var levelAnalyzer = this.levelAnalyzers[chunkMeta.level];
    levelAnalyzer.updateChunkMeasures(chunkMeta, type);
  };

  return PerformanceAnalyzer;
}();

var performance_analyzer_mediaElement = document.querySelector('video');
var hlsInstance = new Hls({
  // progressive: false,
  // debug: true,
  enableWorker: true,
  capLevelToPlayerSize: false,
  maxBufferLength: 60
});
var analyzer = new performance_analyzer_PerformanceAnalyzer(hlsInstance, performance_analyzer_mediaElement); // analyzer.setup('http://localhost:9999/100kb/file.m3u8');
// analyzer.setup('http://localhost:9999/1mb/file.m3u8');
// analyzer.setup('http://localhost:9999/2.5mb/file.m3u8');
// analyzer.setup('http://localhost:9999/5mb/file.m3u8');
// analyzer.setup('http://localhost:9999/10mb/file.m3u8');

analyzer.setup('http://localhost:9999/25mb/file.m3u8'); // analyzer.setup('https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8');

/***/ })

/******/ })["default"];
});
//# sourceMappingURL=hls-performance-analyzer.js.map