import { BufferHelper } from '../utils/buffer-helper';
import Event from '../events';
import EWMA from '../utils/ewma';
import { logger } from '../utils/logger';
import { ErrorDetails } from '../errors';
import { getProgramDateTimeAtEndOfLastEncodedFragment } from './level-helper';
import EventHandler from '../event-handler';

const sampleRate: number = 250;
export default class PlaybackRateController extends EventHandler {
  protected hls: any;
  private config: any;
  private media: any | null = null;
  private ewma: EWMA;
  private latencyTarget: number = 3;
  private latencyCeiling: number = 5;
  private lastUpdatePDT: number | null = null;
  private bufferEndPDT: number | null = null;
  private currentTimePDT: number | null = null;
  private lastUpdateTimestamp: number | null = null;

  private timeupdateHandler = this.doTick.bind(this);

  constructor(hls) {
    super(hls,
      Event.MEDIA_ATTACHED,
      Event.MEDIA_DETACHING,
      Event.ERROR,
      Event.LEVEL_UPDATED,
      Event.FRAG_BUFFERED
    );
    this.hls = hls;
    this.config = hls.config;
    this.ewma = new EWMA(hls.config.abrEwmaFastLive);
  }

  onMediaAttached (data) {
    this.media = data.media;
    this.media.addEventListener('timeupdate', this.timeupdateHandler);
  }

  onMediaDetaching () {
    this.media.removeEventListener('timeupdate', this.timeupdateHandler);
    this.media = null;
  }

  onError (data) {
    if (data.details !== ErrorDetails.BUFFER_STALLED_ERROR) {
      return;
    }
    this.latencyTarget = Math.min(this.latencyTarget + 1, this.latencyCeiling);
    logger.log(`[playback-rate-controller]: Stall detected, adjusting latencyTarget to ${this.latencyTarget}`);
  }

  onLevelUpdated ({ details }) {
    if (details.hasProgramDateTime && details.updated) {
      this.lastUpdatePDT = getProgramDateTimeAtEndOfLastEncodedFragment(details);
      this.lastUpdateTimestamp = Date.now() - details.availabilityDelay;
    }
  }

  onFragBuffered({ frag }) {
    this.bufferEndPDT = frag.programDateTime + (frag.duration * 1000);
  }

  doTick () {
    const { config, latencyTarget, media } = this;
    if (!media || this.bufferEndPDT === null) {
      return;
    }
    const pos = media.currentTime;
    const bufferInfo = BufferHelper.bufferInfo(media, pos, config.maxBufferHole);
    const { end, len } = bufferInfo;

    this.currentTimePDT = this.bufferEndPDT - (len * 1000);
    const latency = this.latency;
    if (latency === null) {
      return;
    }

    const distance = latency - latencyTarget;
    if (distance) {
      if (distance > latencyTarget * 2) {
        const seekPos = end - latencyTarget;
        logger.log(`[playback-rate-controller]: Current position is twice the latency target, seeking to ${seekPos}`);
        media.currentTime = seekPos;
      } else {
        media.playbackRate = sigmoid(latency, latencyTarget);
      }
    } else {
      media.playbackRate = 1;
    }
    // logger.log(`[playback-rate-controller]: The playback rate is ${media.playbackRate}, distance: ${distance}, currentTime: ${media.currentTime}, target: ${latencyTarget}, bufferEnd: ${end}`);
  }

  get latency () {
    if (this.lastUpdatePDT === null || this.bufferEndPDT === null || this.lastUpdateTimestamp === null || this.currentTimePDT === null) {
      return null;
    }

    const timeSinceLastUpdate = Date.now() - this.lastUpdateTimestamp;
    const encoderPDT = timeSinceLastUpdate + this.lastUpdatePDT;
    // const encoderDate = new Date(encoderPDT);
    // const curTime = new Date();
    // const bufEndTime = new Date(this.bufferEndPDT);
    // const posTime = new Date(this.currentTimePDT);
    // console.warn('>>>',
    //   `
    //   Encoder Time: ${encoderDate.getSeconds()}:${encoderDate.getMilliseconds()}
    //   Pos: ${posTime.getSeconds()}:${posTime.getMilliseconds()}
    //   Buffer End Time: ${bufEndTime.getSeconds()}:${bufEndTime.getMilliseconds()}
    //   UTC Time: ${curTime.getSeconds()}:${curTime.getMilliseconds()}`
    // );

    const bufferEndLatency = (Date.now() - this.bufferEndPDT) / 1000;
    const currentTimeLatency = (Date.now() - this.currentTimePDT) / 1000;
    // console.warn('>>>', `
    //   Buffer end latency: ${bufferEndLatency}
    //   Pos latency: ${(currentTimeLatency)}
    //   Target: ${this.latencyTarget}
    // `);

    return currentTimeLatency;
  }
}

const L = 2; // Change playback rate by up to 2x
const k = 0.75;
const sigmoid = (x, x0) => L / (1 + Math.exp(-k * (x - x0)));


// Random TODO: BufferHelper.bufferInfo is used in several classes. Should shift functionality
// into a managed class ala Shaka's playhead controller
