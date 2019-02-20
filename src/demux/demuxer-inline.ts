/**
 *
 * inline demuxer: probe fragments and instantiate
 * appropriate demuxer depending on content type (TSDemuxer, AACDemuxer, ...)
 *
 */
// TODO: Rename to transmuxer
import Event from '../events';
import { ErrorTypes, ErrorDetails } from '../errors';
import Decrypter from '../crypt/decrypter';
import AACDemuxer from '../demux/aacdemuxer';
import MP4Demuxer from '../demux/mp4demuxer';
import TSDemuxer from '../demux/tsdemuxer';
import MP3Demuxer from '../demux/mp3demuxer';
import MP4Remuxer from '../remux/mp4-remuxer';
import PassThroughRemuxer from '../remux/passthrough-remuxer';
import { Demuxer } from '../types/demuxer';
import { Remuxer, RemuxerResult } from '../types/remuxer';

import { getSelfScope } from '../utils/get-self-scope';
import { logger } from '../utils/logger';

// see https://stackoverflow.com/a/11237259/589493
const global = getSelfScope(); // safeguard for code that might run both on worker and main thread

let now;
// performance.now() not available on WebWorker, at least on Safari Desktop
try {
  now = global.performance.now.bind(global.performance);
} catch (err) {
  logger.debug('Unable to use Performance API on this environment');
  now = global.Date.now;
}

class DemuxerInline {
  private observer: any;
  private typeSupported: any;
  private config: any;
  private vendor: any;
  private demuxer!: Demuxer;
  private remuxer!: Remuxer;
  private decrypter: any;
  private probe!: Function;

  constructor (observer, typeSupported, config, vendor) {
    this.observer = observer;
    this.typeSupported = typeSupported;
    this.config = config;
    this.vendor = vendor;
  }

  destroy () {
    let demuxer = this.demuxer;
    if (demuxer) {
      demuxer.destroy();
    }
  }

  push (data: ArrayBuffer,
    decryptdata: any | null,
    initSegment: any,
    audioCodec: string,
    videoCodec: string,
    timeOffset: number,
    discontinuity: boolean,
    trackSwitch: boolean,
    contiguous: boolean,
    duration: number,
    accurateTimeOffset: boolean,
    defaultInitPTS: number
  ): Promise<RemuxerResult> {
    return new Promise((resolve) => {
      if ((data.byteLength > 0) && (decryptdata != null) && (decryptdata.key != null) && (decryptdata.method === 'AES-128')) {
        let decrypter = this.decrypter;
        if (decrypter === null) {
          decrypter = this.decrypter = new Decrypter(this.observer, this.config);
        }

        const startTime = now();
        decrypter.decrypt(data, decryptdata.key.buffer, decryptdata.iv.buffer, (decryptedData) => {
          const endTime = now();
          this.observer.trigger(Event.FRAG_DECRYPTED, { stats: { tstart: startTime, tdecrypt: endTime } });
          resolve(this.pushDecrypted(new Uint8Array(decryptedData), decryptdata, new Uint8Array(initSegment), audioCodec, videoCodec, timeOffset, discontinuity, trackSwitch, contiguous, duration, accurateTimeOffset, defaultInitPTS));
        });
      } else {
        resolve(this.pushDecrypted(new Uint8Array(data), decryptdata, new Uint8Array(initSegment), audioCodec, videoCodec, timeOffset, discontinuity, trackSwitch, contiguous, duration, accurateTimeOffset, defaultInitPTS));
      }
    });
  }

  pushDecrypted (data, decryptdata, initSegment, audioCodec, videoCodec, timeOffset, discontinuity, trackSwitch, contiguous, duration, accurateTimeOffset, defaultInitPTS): Promise<RemuxerResult> {
    let demuxer = this.demuxer;
    if (!demuxer ||
      // in case of continuity change, or track switch
      // we might switch from content type (AAC container to TS container, or TS to fmp4 for example)
      // so let's check that current demuxer is still valid
      ((discontinuity || trackSwitch) && !this.probe(data))) {
      const observer = this.observer;
      const typeSupported = this.typeSupported;
      const config = this.config;
      // probing order is TS/MP4/AAC/MP3
      const muxConfig = [
        { demux: TSDemuxer, remux: MP4Remuxer },
        { demux: MP4Demuxer, remux: PassThroughRemuxer },
        { demux: AACDemuxer, remux: MP4Remuxer },
        { demux: MP3Demuxer, remux: MP4Remuxer }
      ];

      // probe for content type
      for (let i = 0, len = muxConfig.length; i < len; i++) {
        const mux = muxConfig[i];
        const probe = mux.demux.probe;
        if (probe(data)) {
          const remuxer = this.remuxer = new mux.remux(observer, config, typeSupported, this.vendor);
          demuxer = new mux.demux(observer, remuxer, config, typeSupported);
          this.probe = probe;
          break;
        }
      }
      if (!demuxer) {
        observer.trigger(Event.ERROR, { type: ErrorTypes.MEDIA_ERROR, details: ErrorDetails.FRAG_PARSING_ERROR, fatal: true, reason: 'no demux matching with content found' });
        return Promise.reject();
      }
      this.demuxer = demuxer;
    }
    const remuxer = this.remuxer;

    if (discontinuity || trackSwitch) {
      demuxer.resetInitSegment(initSegment, audioCodec, videoCodec, duration);
      remuxer.resetInitSegment();
    }
    if (discontinuity) {
      demuxer.resetTimeStamp(defaultInitPTS);
      remuxer.resetTimeStamp(defaultInitPTS);
    }
    if (typeof demuxer.setDecryptData === 'function') {
      demuxer.setDecryptData(decryptdata);
    }

    return demuxer.append(data, timeOffset, contiguous, accurateTimeOffset);
  }
}

export default DemuxerInline;
