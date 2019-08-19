import * as work from 'webworkify-webpack';
import Event from '../events';
import Transmuxer, { TransmuxConfig, TransmuxState } from '../demux/transmuxer';
import { logger } from '../utils/logger';
import { ErrorTypes, ErrorDetails } from '../errors';
import { getMediaSource } from '../utils/mediasource-helper';
import { getSelfScope } from '../utils/get-self-scope';
import { Observer } from '../observer';
import Fragment from '../loader/fragment';
import { ChunkMetadata, TransmuxerResult } from '../types/transmuxer';

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
  private onTransmuxComplete: Function;
  private onFlush: Function;

  private currentTransmuxSession: ChunkMetadata | null = null;

  constructor (hls, id, onTransmuxComplete, onFlush) {
    this.hls = hls;
    this.id = id;
    this.onTransmuxComplete = onTransmuxComplete;
    this.onFlush = onFlush;

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
    const w = this.worker;
    if (w) {
      w.removeEventListener('message', this.onwmsg);
      w.terminate();
      this.worker = null;
    } else {
      const transmuxer = this.transmuxer;
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

  push (data: Uint8Array, initSegment: any, audioCodec: string, videoCodec: string, frag: Fragment, duration: number, accurateTimeOffset: boolean, chunkMeta: ChunkMetadata, defaultInitPTS?: number): void {
    const { currentTransmuxSession, transmuxer, worker } = this;
    const timeOffset = Number.isFinite(frag.startPTS) ? frag.startPTS : frag.start;
    const decryptdata = frag.decryptdata;
    const lastFrag = this.frag;

    if (startingNewTransmuxSession(currentTransmuxSession, chunkMeta)) {
      frag.stats.parsing.start = performance.now();
      const discontinuity = !(lastFrag && (frag.cc === lastFrag.cc));
      const trackSwitch = !(lastFrag && (frag.level === lastFrag.level));
      const nextSN = !!(lastFrag && (frag.sn === (lastFrag.sn as number + 1)));
      const contiguous = !trackSwitch && nextSN;

      logger.log(`[transmuxer-interface, ${frag.type}]: Starting new transmux session for fragment ${frag.sn}, of level ${frag.level}:
        discontinuity: ${discontinuity}
        trackSwitch: ${trackSwitch}
        contiguous: ${contiguous}
        accurateTimeOffset: ${accurateTimeOffset}
        timeOffset: ${timeOffset}`);
      this.currentTransmuxSession = chunkMeta;
      const config = new TransmuxConfig(audioCodec, videoCodec, new Uint8Array(initSegment), duration, defaultInitPTS);
      const state = new TransmuxState(discontinuity, contiguous, accurateTimeOffset, trackSwitch, timeOffset);
      this.configureTransmuxer(config, state);
    }

    this.frag = frag;
    // Frags with sn of 'initSegment' are not transmuxed
    if (worker) {
      // post fragment payload as transferable objects for ArrayBuffer (no copy)
      worker.postMessage({
        cmd: 'demux',
        data,
        decryptdata,
        chunkMeta
      }, data instanceof ArrayBuffer ? [data] : []);
    } else if (transmuxer) {
      const transmuxResult = transmuxer.push(data, decryptdata, chunkMeta);
      if (!transmuxResult) {
        return;
      }
      // Checking for existence of .then is the safest promise check, since it detects polyfills which aren't instanceof Promise
      // @ts-ignore
      if (transmuxResult.then) {
        // @ts-ignore
        transmuxResult.then(data => {
          this.handleTransmuxComplete(data);
        });
      } else {
        this.handleTransmuxComplete(transmuxResult as TransmuxerResult);
      }
    }
  }

  flush (chunkMeta: ChunkMetadata) {
    const { transmuxer, worker } = this;
    this.currentTransmuxSession = null;
    chunkMeta.transmuxing.start = performance.now();
    if (worker) {
      worker.postMessage({
        cmd: 'flush',
        chunkMeta
      });
    } else if (transmuxer) {
      const transmuxResult = transmuxer.flush(chunkMeta);
      // @ts-ignore
      if (transmuxResult.then) {
        // @ts-ignore
        transmuxResult.then(data => {
          this.handleFlushResult(data, chunkMeta);
        });
      } else {
        this.handleFlushResult(transmuxResult as Array<TransmuxerResult>, chunkMeta);
      }
    }
  }

  private handleFlushResult (results: Array<TransmuxerResult>, chunkMeta: ChunkMetadata) {
    results.forEach(result => {
      this.handleTransmuxComplete(result);
    });
    this.onFlush(chunkMeta);
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

      case 'flush': {
        this.onFlush(data.data);
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

  private configureTransmuxer (config: TransmuxConfig, state: TransmuxState) {
    const { worker, transmuxer } = this;
    if (worker) {
      worker.postMessage({
        cmd: 'configure',
        config,
        state
      })
    } else if (transmuxer) {
      transmuxer.configure(config, state);
    }
  }

  private handleTransmuxComplete (result: TransmuxerResult) {
    result.chunkMeta.transmuxing.end = performance.now();
    this.onTransmuxComplete(result);
  }
}

function startingNewTransmuxSession (currentIdentifier: ChunkMetadata | null, newIdentifier: ChunkMetadata) {
  if (!currentIdentifier) {
    return true;
  }
  return currentIdentifier.sn !== newIdentifier.sn || currentIdentifier.level !== newIdentifier.level;
}
