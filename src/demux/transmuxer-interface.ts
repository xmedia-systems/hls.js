import * as work from 'webworkify-webpack';
import Event from '../events';
import Transmuxer from '../demux/transmuxer';
import { logger } from '../utils/logger';
import { ErrorTypes, ErrorDetails } from '../errors';
import { getMediaSource } from '../utils/mediasource-helper';
import { getSelfScope } from '../utils/get-self-scope';
import { Observer } from '../observer';
import Fragment from '../loader/fragment';

// see https://stackoverflow.com/a/11237259/589493
const global = getSelfScope(); // safeguard for code that might run both on worker and main thread
const MediaSource = getMediaSource();

export default class TransmuxerInterface {
  private hls: any;
  private id: any;
  private observer: any;
  private frag?: Fragment;
  private worker: any;
  private onwmsg?: Function;
  private transmuxer?: Transmuxer | null;

  constructor (hls, id) {
    this.hls = hls;
    this.id = id;

    const observer = this.observer = new Observer();
    const config = hls.config;

    const forwardMessage = (ev, data) => {
      data = data || {};
      data.frag = this.frag;
      data.id = this.id;
      hls.trigger(ev, data);
    };

    // forward events to main thread
    observer.on(Event.FRAG_DECRYPTED, forwardMessage);
    observer.on(Event.ERROR, forwardMessage);
    observer.on('transmuxComplete', forwardMessage);

    const typeSupported = {
      mp4: MediaSource.isTypeSupported('video/mp4'),
      mpeg: MediaSource.isTypeSupported('audio/mpeg'),
      mp3: MediaSource.isTypeSupported('audio/mp4; codecs="mp3"')
    };
    // navigator.vendor is not always available in Web Worker
    // refer to https://developer.mozilla.org/en-US/docs/Web/API/WorkerGlobalScope/navigator
    const vendor = navigator.vendor;
    if (config.enableWorker && (typeof (Worker) !== 'undefined')) {
      logger.log('demuxing in webworker');
      let worker;
      try {
        worker = this.worker = work(require.resolve('../demux/transmuxer-worker.ts'));
        this.onwmsg = this.onWorkerMessage.bind(this);
        worker.addEventListener('message', this.onwmsg);
        worker.onerror = (event) => {
          hls.trigger(Event.ERROR, { type: ErrorTypes.OTHER_ERROR, details: ErrorDetails.INTERNAL_EXCEPTION, fatal: true, event: 'demuxerWorker', err: { message: event.message + ' (' + event.filename + ':' + event.lineno + ')' } });
        };
        worker.postMessage({ cmd: 'init', typeSupported: typeSupported, vendor: vendor, id: id, config: JSON.stringify(config) });
      } catch (err) {
        logger.warn('Error in worker:', err);
        logger.error('Error while initializing DemuxerWorker, fallback to inline');
        if (worker) {
          // revoke the Object URL that was used to create transmuxer worker, so as not to leak it
          global.URL.revokeObjectURL(worker.objectURL);
        }
        this.transmuxer = new Transmuxer(observer, typeSupported, config, vendor);
        this.worker = null;
      }
    } else {
      this.transmuxer = new Transmuxer(observer, typeSupported, config, vendor);
    }
  }

  destroy (): void {
    let w = this.worker;
    if (w) {
      w.removeEventListener('message', this.onwmsg);
      w.terminate();
      this.worker = null;
    } else {
      let transmuxer = this.transmuxer;
      if (transmuxer) {
        transmuxer.destroy();
        this.transmuxer = null;
      }
    }
    const observer = this.observer;
    if (observer) {
      observer.removeAllListeners();
      this.observer = null;
    }
  }

  push (data: Uint8Array, initSegment: any, audioCodec: string, videoCodec: string, frag: Fragment, duration: number, accurateTimeOffset: boolean, defaultInitPTS: number): void {
    const w = this.worker;
    const timeOffset = Number.isFinite(frag.startPTS) ? frag.startPTS : frag.start;
    const decryptdata = frag.decryptdata;
    const lastFrag = this.frag;
    const discontinuity = !(lastFrag && (frag.cc === lastFrag.cc));
    const trackSwitch = !(lastFrag && (frag.level === lastFrag.level));
    const nextSN = lastFrag && (frag.sn === (lastFrag.sn as number + 1));
    const contiguous = !trackSwitch && nextSN;
    if (discontinuity) {
      logger.log(`${this.id}:discontinuity detected`);
    }

    if (trackSwitch) {
      logger.log(`${this.id}:switch detected`);
    }

    this.frag = frag;
    const { transmuxer } = this;
    if (w) {
      // post fragment payload as transferable objects for ArrayBuffer (no copy)
      w.postMessage({
        cmd: 'demux',
        data,
        decryptdata,
        initSegment,
        audioCodec,
        videoCodec,
        timeOffset,
        discontinuity,
        trackSwitch,
        contiguous,
        duration,
        accurateTimeOffset,
        defaultInitPTS
      }, data instanceof ArrayBuffer ? [data] : []);
    } else if (transmuxer) {
      const remuxResult =
        transmuxer.push(data, decryptdata, initSegment, audioCodec, videoCodec, timeOffset, discontinuity, trackSwitch, !!contiguous, duration, accurateTimeOffset, defaultInitPTS);
      if (!remuxResult) {
        return;
      }
      // Checking for existence of .then is the safest promise check, since it detects polyfills which aren't instanceof Promise
      // @ts-ignore
      if (remuxResult.then) {
        // @ts-ignore
        remuxResult.then(data => {
          this.handleTransmuxComplete(data);
        });
      } else {
        this.handleTransmuxComplete(remuxResult);
      }
    }
  }

  private onWorkerMessage (ev: any): void {
    const data = ev.data;
    const hls = this.hls;
    switch (data.event) {
    case 'init': {
      // revoke the Object URL that was used to create transmuxer worker, so as not to leak it
      global.URL.revokeObjectURL(this.worker.objectURL);
      break;
    }
    case 'transmuxComplete': {
      this.handleTransmuxComplete(data.data);
      break;
    }

    /* falls through */
    default: {
      data.data = data.data || {};
      data.data.frag = this.frag;
      data.data.id = this.id;
      hls.trigger(data.event, data.data);
      break;
    }
    }
  }

  // TODO: Does the transfered data need to be converted to uint8?
  private handleTransmuxComplete (remuxResult): void {
    const { frag, hls, id } = this;
    Object.keys(remuxResult).forEach(key => {
      const data = remuxResult[key];
      if (!data) {
        return;
      }
      data.frag = frag;
      data.id = id;
    });
    const { audio, video, text, id3, initSegment } = remuxResult;
    if (initSegment) {
      if (initSegment.tracks) {
        hls.trigger(Event.FRAG_PARSING_INIT_SEGMENT, { frag, id, tracks: initSegment.tracks });
      }
      if (Number.isFinite(initSegment.initPTS)) {
        hls.trigger(Event.INIT_PTS_FOUND, { frag, id, initPTS: initSegment.initPTS });
      }
    }
    if (audio) {
      hls.trigger(Event.FRAG_PARSING_DATA, audio);
    }
    if (video) {
      hls.trigger(Event.FRAG_PARSING_DATA, video);
    }
    if (id3) {
      hls.trigger(Event.FRAG_PARSING_METADATA, id3);
    }
    if (text) {
      hls.trigger(Event.FRAG_PARSING_USERDATA, text);
    }
    hls.trigger(Event.FRAG_PARSED, { frag, id });
  }
}
