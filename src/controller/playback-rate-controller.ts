import { BufferHelper } from '../utils/buffer-helper';
import Event from '../events';
import { logger } from '../utils/logger';
import { ErrorDetails } from '../errors';
import { getProgramDateTimeAtEndOfLastEncodedFragment } from './level-helper';
import EventHandler from '../event-handler';

export default class PlaybackRateController extends EventHandler {
  protected hls: any;
  private config: any;
  private media: any | null = null;
  public latencyTarget: number = 3;
  private latencyCeiling: number = 5;
  private lastUpdatePDT: number | null = null;
  private bufferEndPDT: number | null = null;
  private currentTimePDT: number | null = null;
  private lastUpdateTimestamp: number | null = null;
  private lastCurrentTime: number | null = null;

  private timeupdateHandler = this.doTick.bind(this);

  private _latency: number | null = null;

  constructor(hls) {
    super(hls,
      Event.MEDIA_ATTACHED,
      Event.MEDIA_DETACHING,
      Event.ERROR,
      Event.LEVEL_UPDATED,
      Event.FRAG_CHANGED,
      Event.MANIFEST_LOADING
    );
    this.hls = hls;
    this.config = hls.config;
  }

  onMediaAttached (data) {
    this.media = data.media;
    this.media.addEventListener('timeupdate', this.timeupdateHandler);
  }

  onMediaDetaching () {
    this.media.removeEventListener('timeupdate', this.timeupdateHandler);
    this.media = null;
  }

  onManifestLoading () {
    this.currentTimePDT = null;
    this.lastCurrentTime = null;
    this._latency = null;
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
      this.lastUpdateTimestamp = Date.now();
    }
  }

  onFragChanged ({ frag }) {
    const { media } = this;
    if (!frag.programDateTime || !media || this.currentTimePDT !== null) {
      return;
    }
    this.currentTimePDT = frag.programDateTime;
    this.lastCurrentTime = media.currentTime;
  }

  doTick () {
    const { config, latencyTarget, media } = this;
    if (!media) {
      return;
    }
    const pos = media.currentTime;
    if (this.currentTimePDT !== null && this.lastCurrentTime !== null) {
      this.currentTimePDT += ((pos - this.lastCurrentTime) * 1000);
    }
    this.lastCurrentTime = pos;

    const latency = this.computeLatency();
    if (latency === null) {
      return;
    }
    this._latency = latency;

    const bufferInfo = BufferHelper.bufferInfo(media, pos, config.maxBufferHole);
    const distance = latency - latencyTarget;
    if (distance) {
      if (distance > latencyTarget * 2) {
        const seekPos = bufferInfo.end - latencyTarget;
        logger.log(`[playback-rate-controller]: Current position is twice the latency target, seeking to ${seekPos}`);
        media.currentTime = seekPos;
      } else {
        media.playbackRate = Math.max(0.1, sigmoid(latency, latencyTarget));
      }
    } else {
      media.playbackRate = 1;
    }
  }

  private computeLatency () {
    if (this.currentTimePDT === null) {
      return null;
    }
    return  (Date.now() - this.currentTimePDT) / 1000;
  }

  get latency () {
    return this._latency;
  }

  set latency (target: number) {
    this.latencyTarget = target;
  }
}

const L = 2; // Change playback rate by up to 2x
const k = 0.75;
const sigmoid = (x, x0) => L / (1 + Math.exp(-k * (x - x0)));


// Random TODO: BufferHelper.bufferInfo is used in several classes. Should shift functionality
// into a managed class ala Shaka's playhead controller
