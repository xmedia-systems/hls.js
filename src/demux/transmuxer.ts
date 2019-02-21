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

class Transmuxer {
  private observer: any;
  private typeSupported: any;
  private config: any;
  private vendor: any;
  private demuxer?: Demuxer;
  private remuxer?: Remuxer;
  private decrypter: any;
  private probe!: Function;

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
    defaultInitPTS: number
  ): RemuxerResult | Promise<RemuxerResult> | null {
    const uintData = new Uint8Array(data);
    const uintInitSegment = new Uint8Array(initSegment);
    let { demuxer, remuxer } = this;
    if (!demuxer ||
      // in case of continuity change, or track switch
      // we might switch from content type (AAC container to TS container, or TS to fmp4 for example)
      // so let's check that current demuxer is still valid
      ((discontinuity || trackSwitch) && !this.probe(data))) {
      ({ demuxer, remuxer } = this.configureTransmuxer(uintData));
    }
    if (!demuxer || !remuxer) {
      this.observer.trigger(Event.ERROR, { type: ErrorTypes.MEDIA_ERROR, details: ErrorDetails.FRAG_PARSING_ERROR, fatal: true, reason: 'no demux matching with content found' });
      return null;
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
    const encryptionType = getEncryptionType(uintData, decryptdata);
    if (encryptionType === 'AES-128') {
      result = this.transmuxAes128(uintData, decryptdata, timeOffset, contiguous, accurateTimeOffset);
    } else if (encryptionType === 'SAMPLE-AES') {
      result = this.transmuxSampleAes(uintData, decryptdata, timeOffset, contiguous, accurateTimeOffset);
    } else {
      result = this.transmux(uintData, timeOffset, contiguous, accurateTimeOffset);
    }
    return result;
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

  private transmux (data: Uint8Array, timeOffset: number, contiguous: boolean, accurateTimeOffset: boolean): RemuxerResult {
    const { audioTrack, avcTrack, id3Track, textTrack } = this.demuxer!.demux(data, timeOffset, contiguous, false);
    return this.remuxer!.remux(audioTrack, avcTrack, id3Track, textTrack, timeOffset, contiguous, accurateTimeOffset);
  }

  private transmuxAes128 (data: Uint8Array, decryptData: any, timeOffset: number, contiguous: boolean, accurateTimeOffset: boolean): Promise<RemuxerResult> {
    let decrypter = this.decrypter;
    if (!decrypter) {
      decrypter = this.decrypter = new Decrypter(this.observer, this.config);
    }
    return new Promise(resolve => {
      const startTime = now();
      decrypter.decrypt(data, decryptData.key.buffer, decryptData.iv.buffer, (decryptedData) => {
        const endTime = now();
        this.observer.trigger(Event.FRAG_DECRYPTED, { stats: { tstart: startTime, tdecrypt: endTime } });
        resolve(this.transmux(new Uint8Array(decryptedData), timeOffset, contiguous, accurateTimeOffset));
      });
    });
  }

  private transmuxSampleAes (data: Uint8Array, decryptData: any, timeOffset: number, contiguous: boolean, accurateTimeOffset: boolean) : Promise<RemuxerResult> {
    return this.demuxer!.demuxSampleAes(data, decryptData, timeOffset, contiguous)
      .then(demuxResult =>
        this.remuxer!.remux(demuxResult.audioTrack, demuxResult.avcTrack, demuxResult.id3Track, demuxResult.textTrack, timeOffset, contiguous, accurateTimeOffset)
      );
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
