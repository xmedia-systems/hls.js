import EventHandler from '../event-handler';
import Events from '../events';
import Fragment from '../loader/fragment';
import { logger } from '../utils/logger';
import { LoaderStats } from '../types/loader';
import { ChunkMetadata, statHash } from '../types/transmuxer';

export default class PerformanceMonitor extends EventHandler {
  constructor (hls) {
    super(hls,
      Events.BUFFER_APPENDING,
      Events.BUFFER_APPENDED,
      Events.FRAG_LOADING,
      Events.FRAG_BUFFERED
    );
    this.hls = hls;

    if (hls.config.debug) {
      hls.trigger = (event: string, ...data: Array<any>) => {
        performance.mark(`${event}-start`);
        hls.emit(event, event, ...data);
        performance.mark(`${event}-end`);
        performance.measure(`${event}`, `${event}-start`, `${event}-end`);
      };
    }
  }

  onBufferAppending (data: { chunkMeta: ChunkMetadata }) {
    const { chunkMeta } = data;
    const parseStartHash = statHash(chunkMeta, 'transmuxing','start');
    const parseEndHash = statHash(chunkMeta, 'transmuxing', 'end');
    const parseExecStartHash = statHash(chunkMeta, 'transmuxing', 'executeStart');
    const parseExecEndHash = statHash(chunkMeta, 'transmuxing', 'executeEnd');

    if (data.type === 'video') {
      performance.measure(statHash(chunkMeta, 'transmuxing', 'total'), parseStartHash, parseEndHash);
    }
  }

  onBufferAppended (data: { chunkMeta: ChunkMetadata}) {
    const { chunkMeta } = data;
    if (chunkMeta.buffering.video.end && !chunkMeta.buffering.video.recorded) {
      chunkMeta.buffering.video.recorded = true;
      const bufferStartHash = statHash(chunkMeta, 'buffering-video','start');
      const bufferEndHash = statHash(chunkMeta, 'buffering-video', 'end');
      const bufferExecStartHash = statHash(chunkMeta, 'buffering-video', 'executeStart');
      const bufferExecEndHash = statHash(chunkMeta, 'buffering-video', 'executeEnd');
      performance.measure(statHash(chunkMeta, 'buffering-video', 'total'), bufferExecStartHash,bufferExecEndHash);
    }

    else if (chunkMeta.buffering.audio.end && !chunkMeta.buffering.audio.recorded) {
      chunkMeta.buffering.audio.recorded = true;
      const bufferStartHash = statHash(chunkMeta, 'buffering-audio', 'start');
      const bufferEndHash = statHash(chunkMeta, 'buffering-audio', 'end');
      const bufferExecStartHash = statHash(chunkMeta, 'buffering-audio', 'executeStart');
      const bufferExecEndHash = statHash(chunkMeta, 'buffering-audio', 'executeEnd');
      performance.measure(statHash(chunkMeta, 'buffering-audio', 'total'), bufferExecStartHash, bufferExecEndHash);
    }
  }

  onFragLoading (data: { frag: Fragment }) {
    const frag = data.frag;
    performance.mark(`${frag.level}-${frag.sn} start`);
  }

  onFragBuffered (data: { frag: Fragment }) {
    const { frag } = data;
    performance.mark(`${frag.level}-${frag.sn} end`);
    performance.measure(`frag ${frag.level}-${frag.sn}`, `${frag.level}-${frag.sn} start`, `${frag.level}-${frag.sn} end`);
    logFragStats(frag);
  }
}

function logFragStats (frag: Fragment) {
  const stats = frag.stats;
  const tLoad = stats.loading.end - stats.loading.start;
  const tBuffer = stats.buffering.end - stats.buffering.start;
  const tParse = stats.parsing.end - stats.parsing.start;
  const tTotal = stats.buffering.end - stats.loading.start;


  logger.log(`[performance-monitor]: Stats for fragment ${frag.sn} of level ${frag.level}:
        Size:                       ${((stats.total / 1024)).toFixed(3)} kB
        Chunk Count:                ${stats.chunkCount}
        
        Request:                    ${stats.loading.start.toFixed(3)} ms
        First Byte:                 ${stats.loading.firstByte.toFixed(3)} ms
        Parse Start                 ${stats.parsing.start.toFixed(3)} ms
        Buffering Start:            ${stats.buffering.start.toFixed(3)} ms
        Parse End:                  ${stats.parsing.end.toFixed(3)} ms
        Buffering End:              ${stats.buffering.end.toFixed(3)} ms

        Load Duration:              ${tLoad.toFixed(3)} ms
        Parse Duration:             ${(tParse).toFixed(3)} ms
        Buffer Duration:            ${(tBuffer).toFixed(3)} ms
        End-To-End Duration:        ${(tTotal).toFixed(3)} ms`);
        
        // Transmuxing Idling Total:   ${(stats.parsing.idling).toFixed(3)} ms
        // Transmuxer Executing Total: ${(stats.parsing.executing).toFixed(3)} ms
        // Buffering Idling Total:     ${(stats.buffering.idling).toFixed(3)} ms
        // Buffering Executing Total:  ${(stats.buffering.executing).toFixed(3)} ms`
  // );

  // const record: FragStatsRecord = {
  //   size: stats.loaded,
  //   chunkCount: stats.chunkCount,
  //   tLoad,
  //   tParse,
  //   tBuffer,
  //   tTotal,
  //   rawStats: stats
  // };
}

export interface FragStatsRecord {
  size: number
  chunkCount: number
  tLoad: number
  tParse: number
  tBuffer: number
  tTotal: number
  rawStats: LoaderStats
}
//
// class FragStatsRecord {
//   private frag: Fragment;
//
//   private tLoad: number = 0;
//   private tParse: number = 0;
//   private tBuffer: number = 0;
//   private tTotal: number = 0;
//
//   private stats: LoadStats;
//
//   constructor (frag: Fragment) {
//     this.frag = frag;
//     this.stats = frag.stats;
//   }
//
//   private computeStats () {
//     const stats = this.stats;
//
//     this.tLoad = stats.loading.end - stats.loading.start;
//     this.tBuffer = stats.buffering.end - stats.buffering.start;
//     this.tParse = stats.parsing.end - stats.parsing.start;
//     this.tTotal = stats.buffering.end - stats.loading.start;
//   }
// }