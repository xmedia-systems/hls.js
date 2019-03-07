import TaskLoop from "../task-loop";
import { BufferHelper } from '../utils/buffer-helper';
import Event from '../events';
import EWMA from '../utils/ewma';

const sampleRate: number = 250;

export default class PlaybackRateController extends TaskLoop {
    protected hls: any;
    private config: any;
    private media: any | null = null;
    private ewma: EWMA;
    private latencyTarget = 3;

    constructor(hls) {
        super(hls,
            Event.MEDIA_ATTACHED,
            Event.MEDIA_DETACHING
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


    doTick () {
        const { config, ewma, latencyTarget, media } = this;
        if (!media) {
            return;
        }

        const bufferInfo = BufferHelper.bufferInfo(media, media.currentTime, config.maxBufferHole);
        const bufferLength = bufferInfo.len;
        ewma.sample(1, bufferLength);
        const playbackRate = sigmoid(bufferLength, latencyTarget);
        console.log('>>> playbackRate', playbackRate);
        media.playbackRate = playbackRate;


        if (bufferLength > latencyTarget) {
            if (bufferLength > 5) {
                // media.currentTime = bufferInfo.end - latencyTarget;
            }
            // console.log('>>> setting rate to 1.1');
            // media.playbackRate = 1.2;
        } else if (bufferLength < latencyTarget) {
          // console.log('>>> setting rate to 0.9');
          // media.playbackRate = 0.9;
        }
        // console.log('>>> Client latency:', bufferLen);
    }
}

const L = 2;
const k = 0.5;
const sigmoid = (x, x0) => L / (1 + Math.exp(-k * (x - x0)));

const cma = (prev, cur, numSamples) => ((prev * numSamples) + cur) / (numSamples + 1);

// Random TODO: BufferHelper.bufferInfo is used in several classes. Should shift functionality
// into a managed class ala Shaka's playhead controller
