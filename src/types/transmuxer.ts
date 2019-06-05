import { RemuxerResult } from './remuxer';
import { HlsChunkPerformanceTiming } from './loader';

export interface TransmuxerResult {
    remuxResult: RemuxerResult
    chunkMeta: ChunkMetadata
}

export class ChunkMetadata {
    public level: number;
    public sn: number;
    public transmuxing: HlsChunkPerformanceTiming = { start: 0, executeStart: 0, executeEnd: 0, end: 0 };
    public buffering: HlsChunkPerformanceTiming = { start: 0, executeStart: 0, executeEnd: 0, end: 0 };

    constructor (level, sn) {
        this.level = level;
        this.sn = sn;
    }
}