import TaskLoop from "../task-loop";
import { BufferHelper } from '../utils/buffer-helper';
import Event from '../events';
import EWMA from '../utils/ewma';
import { logger } from '../utils/logger';
import { ErrorDetails } from '../errors';

const sampleRate: number = 250;

export default class PlaybackRateController extends TaskLoop {
  protected hls: any;
  private config: any;
  private media: any | null = null;
  private ewma: EWMA;
  private latencyTarget: number = 1;
  private latencyCeiling: number = 5;

  constructor(hls) {
    super(hls,
      Event.MEDIA_ATTACHED,
      Event.MEDIA_DETACHING,
      Event.ERROR
    );
    this.hls = hls;
    this.config = hls.config;
    this.ewma = new EWMA(hls.config.abrEwmaFastLive);
  }

  onMediaAttached (data) {
    this.media = data.media;
    this.setInterval(sampleRate);
  }

  onMediaDetaching () {
    this.clearInterval();
    this.media = null
  }

  onError (data) {
    if (data.details !== ErrorDetails.BUFFER_STALLED_ERROR) {
      return;
    }
    this.latencyTarget = Math.min(this.latencyTarget + 1, this.latencyCeiling);
    logger.log(`[playback-rate-controller]: Stall detected, adjusting latencyTarget to ${this.latencyTarget}`);
  }


  doTick () {
    const { config, latencyTarget, media } = this;
    if (!media) {
      return;
    }
    const pos = media.currentTime;
    const bufferInfo = BufferHelper.bufferInfo(media, pos, config.maxBufferHole);
    const { end } = bufferInfo;
    const target = end - latencyTarget;
    const distance = target - media.currentTime;

    // TODO: Factor amount of forward buffer into refreshLatency
    // TODO: Make slowdowns less drastic, but still allow it to fall back to the target
    if (distance) {
      if (distance > latencyTarget * 2) {
        logger.log(`[playback-rate-controller]: Current position is twice the latency target, seeking to ${target}`);
        media.currentTime = target;
      } else {
        media.playbackRate = sigmoid(target, media.currentTime);
      }
    } else {
      media.playbackRate = 1;
    }
    logger.log(`[playback-rate-controller]: The playback rate is ${media.playbackRate}, distance: ${distance}, currentTime: ${media.currentTime}, target: ${target}, bufferEnd: ${end}`);
  }
}

const L = 2; // Change playback rate by up to 2x
const k = 0.25;
const sigmoid = (x, x0) => L / (1 + Math.exp(-k * (x - x0)));


// Random TODO: BufferHelper.bufferInfo is used in several classes. Should shift functionality
// into a managed class ala Shaka's playhead controller
