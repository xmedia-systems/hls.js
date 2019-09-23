/*
 * cap stream level to media size dimension controller
*/

import Event from '../events';
import EventHandler from '../event-handler';
import { Level } from '../types/level';
import { ManifestParsedData, BufferCodecsData, MediaAttachingData, FPSDropLevelCappingData, LevelsUpdatedData } from '../types/events';
import StreamController from './stream-controller';

class CapLevelController extends EventHandler {
  public autoLevelCapping: number;
  public firstLevel: number;
  public levels: Array<Level>;
  public media: HTMLVideoElement | null;
  public restrictedLevels: Array<number>;
  public timer: number | undefined;

  private streamController?: StreamController;

  constructor (hls) {
    super(hls,
      Event.FPS_DROP_LEVEL_CAPPING,
      Event.MEDIA_ATTACHING,
      Event.MANIFEST_PARSED,
      Event.LEVELS_UPDATED,
      Event.BUFFER_CODECS,
      Event.MEDIA_DETACHING);

    this.autoLevelCapping = Number.POSITIVE_INFINITY;
    this.levels = [];
    this.firstLevel = -1;
    this.media = null;
    this.restrictedLevels = [];
    this.timer = undefined;
  }

  setStreamController (streamController: StreamController) {
    this.streamController = streamController;
  }

  destroy () {
    if (this.hls.config.capLevelToPlayerSize) {
      this.media = null;
      this.stopCapping();
    }
  }

  onFpsDropLevelCapping (data: FPSDropLevelCappingData) {
    // Don't add a restricted level more than once
    if (CapLevelController.isLevelAllowed(data.droppedLevel, this.restrictedLevels)) {
      this.restrictedLevels.push(data.droppedLevel);
    }
  }

  onMediaAttaching (data: MediaAttachingData) {
    this.media = data.media instanceof HTMLVideoElement ? data.media : null;
  }

  onManifestParsed (data: ManifestParsedData) {
    const hls = this.hls;
    this.restrictedLevels = [];
    this.levels = data.levels;
    this.firstLevel = data.firstLevel;
    if (hls.config.capLevelToPlayerSize && data.video) {
      // Start capping immediately if the manifest has signaled video codecs
      this.startCapping();
    }
  }

  // Only activate capping when playing a video stream; otherwise, multi-bitrate audio-only streams will be restricted
  // to the first level
  onBufferCodecs (data: BufferCodecsData) {
    const hls = this.hls;
    if (hls.config.capLevelToPlayerSize && data.video) {
      // If the manifest did not signal a video codec capping has been deferred until we're certain video is present
      this.startCapping();
    }
  }

  onLevelsUpdated (data: LevelsUpdatedData) {
    this.levels = data.levels;
  }

  onMediaDetaching () {
    this.stopCapping();
  }

  detectPlayerSize () {
    if (this.media && this.mediaHeight > 0 && this.mediaWidth > 0) {
      const levelsLength = this.levels ? this.levels.length : 0;
      if (levelsLength) {
        const hls = this.hls;
        hls.autoLevelCapping = this.getMaxLevel(levelsLength - 1);
        if (hls.autoLevelCapping > this.autoLevelCapping && this.streamController) {
          // if auto level capping has a higher value for the previous one, flush the buffer using nextLevelSwitch
          // usually happen when the user go to the fullscreen mode.
          this.streamController.nextLevelSwitch();
        }
        this.autoLevelCapping = hls.autoLevelCapping;
      }
    }
  }

  /*
  * returns level should be the one with the dimensions equal or greater than the media (player) dimensions (so the video will be downscaled)
  */
  getMaxLevel (capLevelIndex: number): number {
    if (!this.levels) {
      return -1;
    }

    const validLevels = this.levels.filter((level, index) =>
      CapLevelController.isLevelAllowed(index, this.restrictedLevels) && index <= capLevelIndex
    );

    return CapLevelController.getMaxLevelByMediaSize(validLevels, this.mediaWidth, this.mediaHeight);
  }

  startCapping () {
    if (this.timer) {
      // Don't reset capping if started twice; this can happen if the manifest signals a video codec
      return;
    }
    this.autoLevelCapping = Number.POSITIVE_INFINITY;
    this.hls.firstLevel = this.getMaxLevel(this.firstLevel);
    self.clearInterval(this.timer);
    this.timer = self.setInterval(this.detectPlayerSize.bind(this), 1000);
    this.detectPlayerSize();
  }

  stopCapping () {
    this.restrictedLevels = [];
    this.firstLevel = -1;
    this.autoLevelCapping = Number.POSITIVE_INFINITY;
    if (this.timer) {
      self.clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  get mediaWidth (): number {
    let width;
    const media = this.media;
    if (media) {
      width = media.width || media.clientWidth || media.offsetWidth;
      width *= CapLevelController.contentScaleFactor;
    }
    return width;
  }

  get mediaHeight (): number {
    let height;
    const media = this.media;
    if (media) {
      height = media.height || media.clientHeight || media.offsetHeight;
      height *= CapLevelController.contentScaleFactor;
    }
    return height;
  }

  static get contentScaleFactor (): number {
    let pixelRatio = 1;
    try {
      pixelRatio = self.devicePixelRatio;
    } catch (e) {}
    return pixelRatio;
  }

  static isLevelAllowed (level: number, restrictedLevels: Array<number> = []): boolean {
    return restrictedLevels.indexOf(level) === -1;
  }

  static getMaxLevelByMediaSize (levels: Array<Level>, width: number, height: number): number {
    if (!levels || (levels && !levels.length)) {
      return -1;
    }

    // Levels can have the same dimensions but differing bandwidths - since levels are ordered, we can look to the next
    // to determine whether we've chosen the greatest bandwidth for the media's dimensions
    const atGreatestBandiwdth = (curLevel, nextLevel) => {
      if (!nextLevel) {
        return true;
      }

      return curLevel.width !== nextLevel.width || curLevel.height !== nextLevel.height;
    };

    // If we run through the loop without breaking, the media's dimensions are greater than every level, so default to
    // the max level
    let maxLevelIndex = levels.length - 1;

    for (let i = 0; i < levels.length; i += 1) {
      const level = levels[i];
      if ((level.width >= width || level.height >= height) && atGreatestBandiwdth(level, levels[i + 1])) {
        maxLevelIndex = i;
        break;
      }
    }

    return maxLevelIndex;
  }
}

export default CapLevelController;
