import Event from '../../../src/events.js';
import Demuxer from '../../../src/demux/demuxer.js';

const sinon = require('sinon');

describe('Demuxer tests', function () {
  let hls;
  let demux;
  beforeEach(function () {
    hls = {
      trigger: function () {},
      config: { enableWorker: true }
    };
    demux = new Demuxer(hls, 'main');
  });

  describe('with workers', function () {
    it('Demuxer constructor with worker', function () {
      hls.config.enableWorker = true;

      expect(demux.hls).to.equal(hls, 'Hls object created');
      expect(demux.id).to.equal('main', 'Id has been set up');

      expect(demux.observer.trigger).to.exist;
      expect(demux.observer.off).to.exist;
      expect(demux.w).to.exist;
    });

    it('Push data to demuxer with worker', function () {
      let currentFrag = {
        cc: 100,
        sn: 5,
        level: 1,
        timing: { audio: {}, video: {} }
      };
      // Config for push
      demux.frag = currentFrag;

      let newFrag = {
        decryptdata: {},
        cc: 100,
        sn: 6,
        level: 1,
        start: undefined,
        timing: { audio: {}, video: {} }
      };
      let data = new ArrayBuffer(8),
        initSegment = {},
        audioCodec = {},
        videoCodec = {},
        duration = {},
        accurateTimeOffset = {},
        defaultInitPTS = {};

      let stub = sinon.stub(demux.w, 'postMessage').callsFake(function (obj1, obj2) {
        expect(obj1.cmd).to.equal('demux', 'cmd');
        expect(obj1.data).to.equal(data, 'data');
        expect(obj1.decryptdata).to.equal(newFrag.decryptdata, 'decryptdata');
        expect(obj1.initSegment).to.equal(initSegment, 'initSegment');
        expect(obj1.audioCodec).to.equal(audioCodec, 'audioCodec');
        expect(obj1.videoCodec).to.equal(videoCodec, 'videoCodec');
        expect(obj1.timeOffset).to.equal(newFrag.timing.video.startDTS, 'timeOffset');
        expect(obj1.discontinuity).to.be.false;
        expect(obj1.trackSwitch).to.be.false;
        expect(obj1.contiguous).to.be.true;
        expect(obj1.duration).to.equal(duration, 'duration');
        expect(obj1.defaultInitPTS).to.equal(defaultInitPTS, 'defaultInitPTS');
        expect(obj2[0]).to.equal(data, 'ArrayBuffer');
      });

      demux.push(data, initSegment, audioCodec, videoCodec, newFrag, duration, accurateTimeOffset, defaultInitPTS);
      expect(stub).to.have.been.calledOnce;
    });

    it('Sent worker generic message', function () {
      demux.frag = {};

      let evt = {
        data: {
          event: {},
          data: {}
        }
      };

      hls.trigger = function (event, data) {
        expect(event).to.equal(evt.data.event);
        expect(data).to.equal(evt.data.data);
        expect(evt.data.data.frag).to.equal(demux.frag);
        expect(evt.data.data.id).to.equal('main');
      };

      demux.onWorkerMessage(evt);
    });

    it('Sent worker message type main', function () {
      let evt = {
        data: {
          event: 'init',
          data: {}
        }
      };

      let spy = sinon.spy(window.URL, 'revokeObjectURL');

      demux.onWorkerMessage(evt);

      expect(spy).to.have.been.calledOnce;
    });

    it('Sent worker message FRAG_PARSING_DATA', function () {
      let evt = {
        data: {
          event: Event.FRAG_PARSING_DATA,
          data: {},
          data1: {},
          data2: {}
        }
      };

      demux.onWorkerMessage(evt);

      expect(evt.data.data.data1).to.exist;
      expect(evt.data.data.data2).to.exist;
    });

    it('Destroy demuxer worker', function () {
      demux.destroy();

      expect(demux.observer).to.not.exist;
      expect(demux.demuxer).to.not.exist;
      expect(demux.w).to.not.exist;
    });
  });

  describe('without workers', function () {
    beforeEach(function () {
      hls = {
        trigger: function () {
        },
        config: { enableWorker: false }
      };
      demux = new Demuxer(hls, 'main');
    });

    it('Demuxer constructor no worker', function () {
      expect(demux.hls).to.equal(hls, 'Hls object created');
      expect(demux.id).to.equal('main', 'Id has been set up');
      expect(demux.observer.trigger).to.exist;
      expect(demux.observer.off).to.exist;
      expect(demux.demuxer).to.exist;
    });

    it('Destroy demuxer no worker', function () {
      demux.destroy();

      expect(demux.observer).to.not.exist;
      expect(demux.demuxer).to.not.exist;
      expect(demux.w).to.not.exist;
    });

    it('Push data to demuxer without worker', function () {
      let currentFrag = {
        cc: 100,
        sn: 5,
        level: 1,
        timing: {audio: {}, video: {}}
      };
      // Config for push
      demux.frag = currentFrag;

      let newFrag = {
        decryptdata: {},
        cc: 200,
        sn: 5,
        level: 2,
        startDTS: undefined,
        start: 1000,
        timing: {audio: {}, video: {}}
      };
      let data = {},
        initSegment = {},
        audioCodec = {},
        videoCodec = {},
        duration = {},
        accurateTimeOffset = {},
        defaultInitPTS = {};

      let stub = sinon.stub(demux.demuxer, 'push').callsFake(function (obj1, obj2, obj3, obj4, obj5, obj6, obj7, obj8, obj9, obj10, obj11, obj12) {
        expect(obj1).to.equal(data);
        expect(obj2).to.equal(newFrag.decryptdata);
        expect(obj3).to.equal(initSegment);
        expect(obj4).to.equal(audioCodec);
        expect(obj5).to.equal(videoCodec);
        expect(obj6).to.equal(newFrag.start);
        expect(obj7).to.be.true;
        expect(obj8).to.be.true;
        expect(obj9).to.be.false;
        expect(obj10).to.equal(duration);
        expect(obj11).to.equal(accurateTimeOffset);
        expect(obj12).to.equal(defaultInitPTS);
      });

      demux.push(data, initSegment, audioCodec, videoCodec, newFrag, duration, accurateTimeOffset, defaultInitPTS);
      expect(stub).to.have.been.calledOnce;
    });
  });

  describe('timeOffset calculation', function () {
    it('uses the lastFrag endDTS as a timeOffset when available', function () {

    });
  });
});
