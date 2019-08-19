import { LoaderStats } from '../../src/types/loader';
import Fragment from '../../src/loader/fragment';
import LevelMeasurement from './LevelMeasurement';
import { Level } from '../../src/types/level';
import level from '../../../media-lighthouse/src/hls/level';
import {ChunkMetadata} from "../../src/types/transmuxer";

const Hls = window.Hls;
const Events = Hls.Events;

class PerformanceAnalyzer {
  private hls: any;
  private mediaElement: HTMLMediaElement;
  private listeners: HlsListener[] = [];
  private levelAnalyzers: LevelMeasurement[] = [];

  constructor (hls, mediaElement) {
    this.hls = hls;
    this.mediaElement = mediaElement;
    this.listeners = this.createListeners();
  }

  setup (src: string, setPerformanceMarks: boolean = false) {
    const { hls, listeners, mediaElement } = this;

    if (setPerformanceMarks) {
      this.setTriggerMarks();
    }

    listeners.forEach(l => {
      hls.on(l.name, l.fn);
    });

    hls.loadSource(src);
    hls.attachMedia(mediaElement);
  }

  destroy () {
    const { hls, listeners } = this;
    listeners.forEach(l => {
      hls.off(l.name, l.fn);
    });
  }

  private setTriggerMarks () {
    const { hls } = this;
    hls.trigger = (event: string, ...data: Array<any>) => {
      performance.mark(`${event}-start`);
      hls.emit(event, event, ...data);
      performance.mark(`${event}-end`);
      performance.measure(`${event}`, `${event}-start`, `${event}-end`);
    };
  }

  private createListeners (): HlsListener[] {
    return [
      { name: Events.BUFFER_APPENDED, fn: this.onBufferAppended.bind(this) },
      { name: Events.MANIFEST_PARSED, fn: this.onManifestParsed.bind(this) },
      { name: Events.FRAG_BUFFERED, fn: this.onFragBuffered.bind(this) }
    ];
  }

  private onManifestParsed (e, data: { levels: Level[] }) {
    const { mediaElement } = this;
    data.levels.forEach((level, i) => {
      this.levelAnalyzers.push(new LevelMeasurement(level, i));
    });

    mediaElement.play();
  }

  private onFragBuffered (e: string, data: { frag: Fragment, stats: LoaderStats }) {
    const { frag, stats } = data;
    const levelAnalyzer = this.levelAnalyzers[frag.level];
    levelAnalyzer.updateFragmentMeasures(stats);
  }

  private onBufferAppended (e: string, data: { type: string, chunkMeta: ChunkMetadata }) {
    const { chunkMeta, type } = data;
    const levelAnalyzer = this.levelAnalyzers[chunkMeta.level];
    levelAnalyzer.updateChunkMeasures(chunkMeta, type);
  }
}

interface HlsListener {
  name: string
  fn: (e: string, data: any) => void
}

const mediaElement = document.querySelector('video');
const hlsInstance = new Hls({
  // progressive: false,
  // debug: true,
  enableWorker: true,
  capLevelToPlayerSize: false,
  maxBufferLength: 60
});
const analyzer = new PerformanceAnalyzer(hlsInstance, mediaElement);
// analyzer.setup('http://localhost:9999/100kb/file.m3u8');
// analyzer.setup('http://localhost:9999/1mb/file.m3u8');
// analyzer.setup('http://localhost:9999/2.5mb/file.m3u8');
// analyzer.setup('http://localhost:9999/5mb/file.m3u8');
// analyzer.setup('http://localhost:9999/10mb/file.m3u8');
analyzer.setup('http://localhost:9999/25mb/file.m3u8');
// analyzer.setup('https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8');
