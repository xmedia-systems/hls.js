import { RemuxerResult } from './remuxer';
import { HlsChunkPerformanceTiming } from './loader';
import { SourceBufferListener, SourceBufferName } from './buffer';

export interface TransmuxerResult {
    remuxResult: RemuxerResult
    chunkMeta: ChunkMetadata
}

export class ChunkMetadata {
    public level: number;
    public sn: number;
    public chunkId: number;

    public transmuxing: HlsChunkPerformanceTiming;
    public buffering:  { [key in SourceBufferName]: HlsChunkPerformanceTiming };

    constructor (level, sn, chunkId) {
        this.level = level;
        this.sn = sn;
        this.chunkId = chunkId;

        this.transmuxing = statFactory(this, 'transmuxing');
        this.buffering = {
          audio: statFactory(this, 'buffering-audio'),
          video: statFactory(this, 'buffering-video'),
          audiovideo: statFactory(this, 'buffering-audiovideo'),
        };
    }
}

export const statHash = (chunkMeta: ChunkMetadata, bucket: string, statName: string) => `${chunkMeta.level}-${chunkMeta.sn}-${chunkMeta.chunkId}-${bucket}-${statName}`;

function statFactory (chunkMeta: ChunkMetadata, bucket: string): HlsChunkPerformanceTiming {
    const startHash = statHash(chunkMeta, bucket,'start');
    const endHash = statHash(chunkMeta, bucket, 'end');
    const execStartHash = statHash(chunkMeta, bucket, 'executeStart');
    const execEndHash = statHash(chunkMeta, bucket, 'executeEnd');

    const markableStat = (markHash: string) => {
        let value = 0;
        return {
            get () {
              return value;
            },
            set (val) {
              performance.mark(markHash);
              value = val;
            },
          enumerable: true
        };
    };

    return Object.defineProperties({ recorded: false }, {
        start: markableStat(startHash),
        end: markableStat(endHash),
        executeStart: markableStat(execStartHash),
        executeEnd: markableStat(execEndHash),
    });
}
