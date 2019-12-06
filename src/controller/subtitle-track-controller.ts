import Event from '../events';
import EventHandler from '../event-handler';
import { logger } from '../utils/logger';
import { computeReloadInterval } from './level-helper';
import { MediaPlaylist } from '../types/media-playlist';
import { TrackLoadedData, ManifestLoadedData, MediaAttachedData, SubtitleTracksUpdated } from '../types/events';

class SubtitleTrackController extends EventHandler {
  private tracks: MediaPlaylist[];
  private trackId: number = -1;
  private media: HTMLVideoElement | null = null;
  private stopped: boolean = true;
  private subtitleDisplay: boolean = true; // Enable/disable subtitle display rendering
  private queuedDefaultTrack?: number;
  private trackChangeListener: () => void = () => this._onTextTracksChanged();
  private useTextTrackPolling: boolean = false;
  private subtitlePollingInterval: number = -1;
  private timer: number | null = null;

  constructor (hls) {
    super(hls,
      Event.MEDIA_ATTACHED,
      Event.MEDIA_DETACHING,
      Event.MANIFEST_LOADED,
      Event.SUBTITLE_TRACK_LOADED);
    this.tracks = [];
  }

  // Listen for subtitle track change, then extract the current track ID.
  protected onMediaAttached (data: MediaAttachedData): void {
    this.media = data.media;
    if (!this.media) {
      return;
    }

    if (this.queuedDefaultTrack) {
      this.subtitleTrack = this.queuedDefaultTrack;
      delete this.queuedDefaultTrack;
    }

    this.useTextTrackPolling = !(this.media.textTracks && 'onchange' in this.media.textTracks);
    if (this.useTextTrackPolling) {
      this.subtitlePollingInterval = self.setInterval(() => {
        this.trackChangeListener();
      }, 500);
    } else {
      this.media.textTracks.addEventListener('change', this.trackChangeListener);
    }
  }

  protected onMediaDetaching (): void {
    if (!this.media) {
      return;
    }

    if (this.useTextTrackPolling) {
      self.clearInterval(this.subtitlePollingInterval);
    } else {
      this.media.textTracks.removeEventListener('change', this.trackChangeListener);
    }

    this.media = null;
  }

  // Fired whenever a new manifest is loaded.
  protected onManifestLoaded (data: ManifestLoadedData): void {
    const subtitleTracks = data.subtitles || [];
    this.tracks = subtitleTracks;
    const subtitleTracksUpdated: SubtitleTracksUpdated = { subtitleTracks };
    this.hls.trigger(Event.SUBTITLE_TRACKS_UPDATED, subtitleTracksUpdated);

    // loop through available subtitle tracks and autoselect default if needed
    // TODO: improve selection logic to handle forced, etc
    subtitleTracks.forEach((track: MediaPlaylist) => {
      if (track.default) {
        // setting this.subtitleTrack will trigger internal logic
        // if media has not been attached yet, it will fail
        // we keep a reference to the default track id
        // and we'll set subtitleTrack when onMediaAttached is triggered
        if (this.media) {
          this.subtitleTrack = track.id;
        } else {
          this.queuedDefaultTrack = track.id;
        }
      }
    });
  }

  protected onSubtitleTrackLoaded (data: TrackLoadedData): void {
    const { id, details } = data;
    const { trackId, tracks } = this;
    const currentTrack = tracks[trackId];
    const curDetails = currentTrack.details;

    if (id >= tracks.length || id !== trackId || !currentTrack || this.stopped) {
      this._clearReloadTimer();
      return;
    }

    currentTrack.details = data.details;
    logger.log(`[subtitle-track-controller]: subtitle track ${id} loaded [${details.startSN},${details.endSN}]`);

    if (details.live) {
      details.reloaded(curDetails);
      const reloadInterval = computeReloadInterval(details, data.stats);
      logger.log(`[subtitle-track-controller]: live subtitle track ${details.updated ? 'REFRESHED' : 'MISSED'}, reload in ${Math.round(reloadInterval)} ms`);
      this.timer = self.setTimeout(() => {
        this._loadCurrentTrack();
      }, reloadInterval);
    } else {
      this._clearReloadTimer();
    }
  }

  public startLoad (): void {
    this.stopped = false;
    this._loadCurrentTrack();
  }

  public stopLoad (): void {
    this.stopped = true;
    this._clearReloadTimer();
  }

  /** get alternate subtitle tracks list from playlist **/
  get subtitleTracks (): MediaPlaylist[] {
    return this.tracks;
  }

  /** get index of the selected subtitle track (index in subtitle track lists) **/
  get subtitleTrack (): number {
    return this.trackId;
  }

  /** select a subtitle track, based on its index in subtitle track lists**/
  set subtitleTrack (subtitleTrackId: number) {
    if (this.trackId !== subtitleTrackId) {
      this._toggleTrackModes(subtitleTrackId);
      this._setSubtitleTrackInternal(subtitleTrackId);
    }
  }

  private _clearReloadTimer (): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private _loadCurrentTrack (): void {
    const { trackId, tracks, hls } = this;
    const currentTrack = tracks[trackId];
    if (trackId < 0 || !currentTrack || (currentTrack.details && !currentTrack.details.live)) {
      return;
    }
    logger.log(`[subtitle-track-controller]: Loading subtitle track ${trackId}`);
    hls.trigger(Event.SUBTITLE_TRACK_LOADING, { url: currentTrack.url, id: trackId });
  }

  /**
   * Disables the old subtitleTrack and sets current mode on the next subtitleTrack.
   * This operates on the DOM textTracks.
   * A value of -1 will disable all subtitle tracks.
   */
  private _toggleTrackModes (newId: number): void {
    const { media, subtitleDisplay, trackId } = this;
    if (!media) {
      return;
    }

    const textTracks = filterSubtitleTracks(media.textTracks);
    if (newId === -1) {
      [].slice.call(textTracks).forEach(track => {
        track.mode = 'disabled';
      });
    } else {
      const oldTrack = textTracks[trackId];
      if (oldTrack) {
        oldTrack.mode = 'disabled';
      }
    }

    const nextTrack = textTracks[newId];
    if (nextTrack) {
      nextTrack.mode = subtitleDisplay ? 'showing' : 'hidden';
    }
  }

  /**
     * This method is responsible for validating the subtitle index and periodically reloading if live.
     * Dispatches the SUBTITLE_TRACK_SWITCH event, which instructs the subtitle-stream-controller to load the selected track.
     */
  private _setSubtitleTrackInternal (newId: number): void {
    const { hls, tracks } = this;
    if (!Number.isFinite(newId) || newId < -1 || newId >= tracks.length) {
      return;
    }

    this.trackId = newId;
    logger.log(`[subtitle-track-controller]: Switching to subtitle track ${newId}`);
    hls.trigger(Event.SUBTITLE_TRACK_SWITCH, { id: newId });
    this._loadCurrentTrack();
  }

  private _onTextTracksChanged (): void {
    // Media is undefined when switching streams via loadSource()
    if (!this.media || !this.hls.config.renderNatively) {
      return;
    }

    let trackId: number = -1;
    const tracks = filterSubtitleTracks(this.media.textTracks);
    for (let id = 0; id < tracks.length; id++) {
      if (tracks[id].mode === 'hidden') {
        // Do not break in case there is a following track with showing.
        trackId = id;
      } else if (tracks[id].mode === 'showing') {
        trackId = id;
        break;
      }
    }

    // Setting current subtitleTrack will invoke code.
    this.subtitleTrack = trackId;
  }
}

function filterSubtitleTracks (textTrackList: TextTrackList): TextTrack[] {
  const tracks: TextTrack[] = [];
  for (let i = 0; i < textTrackList.length; i++) {
    const track = textTrackList[i];
    // Edge adds a track without a label; we don't want to use it
    if (track.kind === 'subtitles' && track.label) {
      tracks.push(textTrackList[i]);
    }
  }
  return tracks;
}

export default SubtitleTrackController;
