/**
 *
 * inline demuxer: probe fragments and instantiate
 * appropriate demuxer depending on content type (TSDemuxer, AACDemuxer, ...)
 *
 */
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
import { Remuxer } from '../types/remuxer';
import { TransmuxerResult, TransmuxIdentifier } from '../types/transmuxer';

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

class Transmuxer {
  private observer: any;
  private typeSupported: any;
  private config: any;
  private vendor: any;
  private demuxer?: Demuxer;
  private remuxer?: Remuxer;
  private decrypter: any;
  private probe!: Function;

  private contiguous: boolean = false;
  private timeOffset: number = 0;
  private accurateTimeOffset: boolean = false;

  constructor (observer, typeSupported, config, vendor) {
    this.observer = observer;
    this.typeSupported = typeSupported;
    this.config = config;
    this.vendor = vendor;
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
    defaultInitPTS: number,
    transmuxIdentifier: TransmuxIdentifier
  ): TransmuxerResult | Promise<TransmuxerResult> {
    const uintData = new Uint8Array(data);
    const encryptionType = getEncryptionType(uintData, decryptdata);

    if (encryptionType === 'AES-128') {
      return this.decryptAes128(uintData, decryptdata)
        .then(decryptedData => {
          return this.push(decryptedData,
            null,
            initSegment,
            audioCodec,
            videoCodec,
            timeOffset,
            discontinuity,
            trackSwitch,
            contiguous,
            duration,
            accurateTimeOffset,
            defaultInitPTS,
            transmuxIdentifier);
        })
    }

    const uintInitSegment = new Uint8Array(initSegment);
    this.contiguous = contiguous;
    this.timeOffset = timeOffset;
    this.accurateTimeOffset = accurateTimeOffset;

    const { demuxer, remuxer } = this.getMuxers(uintData, discontinuity, trackSwitch);

    if (!demuxer || !remuxer) {
      this.observer.trigger(Event.ERROR, { type: ErrorTypes.MEDIA_ERROR, details: ErrorDetails.FRAG_PARSING_ERROR, fatal: true, reason: 'no demux matching with content found' });
      return {
        remuxResult: {},
        transmuxIdentifier
      };
    }

    if (discontinuity || trackSwitch) {
      demuxer.resetInitSegment(uintInitSegment, audioCodec, videoCodec, duration);
      remuxer.resetInitSegment(uintInitSegment, audioCodec, videoCodec);
    }
    if (discontinuity) {
      demuxer.resetTimeStamp(defaultInitPTS);
      remuxer.resetTimeStamp(defaultInitPTS);
    }

   let result;
   if (encryptionType === 'SAMPLE-AES') {
      result = this.transmuxSampleAes(uintData, decryptdata, timeOffset, contiguous, accurateTimeOffset, transmuxIdentifier);
    } else {
      result = this.transmux(uintData, timeOffset, contiguous, accurateTimeOffset, transmuxIdentifier);
    }
    return result;
  }

  flush (transmuxIdentifier: TransmuxIdentifier) {
    if (!this.demuxer) {
      return {
        remuxResult: {},
        transmuxIdentifier
      }
    }
    const { audioTrack, avcTrack, id3Track, textTrack } = this.demuxer!.flush(this.timeOffset, this.contiguous);
    // TODO: ensure that remuxers use last DTS as the timeOffset when passed null
    return {
        remuxResult: this.remuxer!.remux(audioTrack, avcTrack, id3Track, textTrack, this.timeOffset, this.contiguous, this.accurateTimeOffset),
        transmuxIdentifier
    }
  }

  destroy (): void {
    if (this.demuxer) {
      this.demuxer.destroy();
      this.demuxer = undefined;
    }
    if (this.remuxer) {
      this.remuxer.destroy();
      this.remuxer = undefined;
    }
  }

  private transmux (data: Uint8Array, timeOffset: number, contiguous: boolean, accurateTimeOffset: boolean, transmuxIdentifier: TransmuxIdentifier): TransmuxerResult {
    const { audioTrack, avcTrack, id3Track, textTrack } = this.demuxer!.demux(data, timeOffset, contiguous, false);
    return {
        remuxResult: this.remuxer!.remux(audioTrack, avcTrack, id3Track, textTrack, timeOffset, contiguous, accurateTimeOffset),
        transmuxIdentifier
    }
  }

  private transmuxSampleAes (data: Uint8Array, decryptData: any, timeOffset: number, contiguous: boolean, accurateTimeOffset: boolean, transmuxIdentifier: TransmuxIdentifier) : Promise<TransmuxerResult> {
    return this.demuxer!.demuxSampleAes(data, decryptData, timeOffset, contiguous)
      .then(demuxResult => ({
              remuxResult: this.remuxer!.remux(demuxResult.audioTrack, demuxResult.avcTrack, demuxResult.id3Track, demuxResult.textTrack, timeOffset, contiguous, accurateTimeOffset),
              transmuxIdentifier
          })
      );
  }

  private decryptAes128 (data: Uint8Array, decryptData: any): Promise<ArrayBuffer> {
    let decrypter = this.decrypter;
    if (!decrypter) {
      decrypter = this.decrypter = new Decrypter(this.observer, this.config);
    }
    return new Promise(resolve => {
      const startTime = now();
      decrypter.decrypt(data, decryptData.key.buffer, decryptData.iv.buffer, (decryptedData) => {
        const endTime = now();
        this.observer.trigger(Event.FRAG_DECRYPTED, { stats: { tstart: startTime, tdecrypt: endTime } });
        resolve(decryptedData);
      });
    });
  }

  private getMuxers (data: Uint8Array, discontinuity, trackSwitch) {
    let { demuxer, remuxer } = this;
    if (!demuxer ||
      // in case of continuity change, or track switch
      // we might switch from content type (AAC container to TS container, or TS to fmp4 for example)
      // so let's check that current demuxer is still valid
      ((discontinuity || trackSwitch) && !this.probe(data))) {
      ({ demuxer, remuxer } = this.configureTransmuxer(data));
    }
    return { demuxer, remuxer };
  }

  private configureTransmuxer (data: Uint8Array) {
    const { config, observer, typeSupported, vendor } = this;
    let demuxer, remuxer;
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
        remuxer = this.remuxer = new mux.remux(observer, config, typeSupported, vendor);
        demuxer = this.demuxer = new mux.demux(observer, config, typeSupported);
        this.probe = probe;
        break;
      }
    }

    return { demuxer, remuxer };
  }
}

function getEncryptionType (data: Uint8Array, decryptData: any): string | null {
  let encryptionType = null;
  if ((data.byteLength > 0) && (decryptData != null) && (decryptData.key != null)) {
    encryptionType = decryptData.method;
  }
  return encryptionType;
}

export default Transmuxer;
